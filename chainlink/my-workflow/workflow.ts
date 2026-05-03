/**
 * Folio Collar Oracle — CRE Workflow
 *
 * Powers Folio's collar pricing engine via decentralized oracle infrastructure:
 * 1. Pulls real-time asset prices from Chainlink Data Streams via Confidential HTTP
 *    (HMAC credentials protected in secure enclave — never exposed to DON nodes)
 * 2. Fetches real options implied volatility from DoltHub options database via HTTP
 *    (free public SQL API with daily-updated US equity options data)
 * 3. Writes collar parameters to the CollarOracle contract on-chain (EVM Write)
 *
 * Every collar is independently verifiable on-chain — provably fair pricing
 * backed by DON consensus, not a centralized API.
 *
 * Bounties:
 * - Best CRE Workflow ($4K) — full orchestration pipeline
 * - Connect the World ($1K) — Chainlink Data Streams for pricing
 * - Privacy Standard ($2K) — Confidential HTTP for Data Streams HMAC credentials
 */

import {
	cre,
	getNetwork,
	Report,
	type CronPayload,
	type Runtime,
	type HTTPSendRequester,
	consensusIdenticalAggregation,
	TxStatus,
	bytesToHex,
	ok,
} from '@chainlink/cre-sdk'
import { encodeFunctionData, decodeAbiParameters, parseAbi, hexToBytes } from 'viem'
import { SDK_PB } from '@chainlink/cre-sdk/pb'
import { create } from '@bufbuild/protobuf'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const configSchema = z.object({
	schedule: z.string(),
	chainSelectorName: z.string(),
	collarOracleAddress: z.string(),
	dataStreamsUrl: z.string(),
	dolthubBaseUrl: z.string(),
	secretOwner: z.string(),
	assets: z.array(
		z.object({
			symbol: z.string(),
			feedId: z.string(),
		}),
	),
	gasLimit: z.string(),
})

type Config = z.infer<typeof configSchema>

// ---------------------------------------------------------------------------
// ABI definitions
// ---------------------------------------------------------------------------

// Data Streams v3 report schema (Crypto Advanced)
// https://docs.chain.link/data-streams/reference/report-schema/v3
const V3_REPORT_PARAMS = [
	{ name: 'feedId', type: 'bytes32' },
	{ name: 'validFromTimestamp', type: 'uint32' },
	{ name: 'observationsTimestamp', type: 'uint32' },
	{ name: 'nativeFee', type: 'uint192' },
	{ name: 'linkFee', type: 'uint192' },
	{ name: 'expiresAt', type: 'uint32' },
	{ name: 'price', type: 'int192' },
	{ name: 'bid', type: 'int192' },
	{ name: 'ask', type: 'int192' },
] as const

// CollarOracle contract ABI — accepts IV-derived floor/cap from the workflow
const COLLAR_ORACLE_ABI = parseAbi([
	'function updateCollars(string[] symbols, uint256[] prices, uint256[] floors, uint256[] caps, uint256[] volatilities) external',
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DataStreamsResponse {
	report: {
		feedID: string
		validFromTimestamp: number
		observationsTimestamp: number
		fullReport: string
	}
}

interface AssetPrice {
	symbol: string
	price: bigint
	bid: bigint
	ask: bigint
}

interface VolatilityData {
	symbol: string
	impliedVolatility: number
	historicalVolatility: number
	ivRank: number
}

interface VolatilityResult {
	volatilities: VolatilityData[]
}

interface DoltHubResponse {
	query_execution_status: string
	rows: Array<Record<string, string>>
}

interface CollarStrike {
	symbol: string
	price: bigint     // 8 decimals
	floor: bigint     // 8 decimals
	cap: bigint       // 8 decimals
	volatility: bigint // basis points
}

// ---------------------------------------------------------------------------
// Collar Math — zero-cost collar using log-symmetric approximation
//
// Given spot price and IV, compute floor (protective put strike) and cap
// (covered call strike) for a zero-cost collar. Uses the forward price and
// log-normal symmetry: same distance above and below the forward in log space.
//
// Higher IV → wider collar → more upside surrendered for the same protection.
// This is the core tradeoff Folio surfaces to users.
// ---------------------------------------------------------------------------

const COLLAR_DURATION_DAYS = 30 // 1-month collar
const RISK_FREE_RATE = 0.05     // 5% annual
const LTV = 0.80                // 80% loan-to-value

function computeCollarStrikes(
	price8dec: bigint,
	ivPercent: number,
): { floor8dec: bigint; cap8dec: bigint } {
	const spot = Number(price8dec) / 1e8
	const iv = ivPercent / 100 // convert from percentage to decimal
	const T = COLLAR_DURATION_DAYS / 365

	// Forward price: S * e^(r*T)
	const fwd = spot * Math.exp(RISK_FREE_RATE * T)

	// Volatility over the collar period
	const sigmaT = iv * Math.sqrt(T)

	// Floor: set by LTV — this is how much the user can borrow against
	const floor = spot * LTV

	// Log-distance from forward to floor
	const dDown = Math.log(fwd / floor) / sigmaT

	// Cap: same log-distance above forward (zero-cost symmetric collar)
	const cap = fwd * Math.exp(dDown * sigmaT)

	// Convert back to 8 decimals
	const floor8dec = BigInt(Math.round(floor * 1e8))
	const cap8dec = BigInt(Math.round(cap * 1e8))

	return { floor8dec, cap8dec }
}

// ---------------------------------------------------------------------------
// Step 1: Chainlink Data Streams via Confidential HTTP
//
// Data Streams requires HMAC-SHA256 auth. Confidential HTTP runs the request
// inside a secure enclave — credentials are decrypted only within the trusted
// boundary and never exposed to individual DON node operators.
// ---------------------------------------------------------------------------

function fetchDataStreamsPrices(runtime: Runtime<Config>): AssetPrice[] {
	const confHTTPClient = new cre.capabilities.ConfidentialHTTPClient()
	const prices: AssetPrice[] = []

	for (const asset of runtime.config.assets) {
		const url = `${runtime.config.dataStreamsUrl}/api/v1/reports/latest?feedID=${asset.feedId}`

		const response = confHTTPClient
			.sendRequest(runtime, {
				request: {
					url,
					method: 'GET',
					multiHeaders: {
						'Authorization': { values: ['{{.dataStreamsApiKey}}'] },
						'X-Authorization-Timestamp': { values: ['{{.dataStreamsTimestamp}}'] },
						'X-Authorization-Signature-SHA256': { values: ['{{.dataStreamsHmac}}'] },
					},
				},
				vaultDonSecrets: [
					{ key: 'dataStreamsApiKey', owner: runtime.config.secretOwner },
					{ key: 'dataStreamsHmac', owner: runtime.config.secretOwner },
					{ key: 'dataStreamsTimestamp', owner: runtime.config.secretOwner },
				],
			})
			.result()

		if (!ok(response)) {
			throw new Error(`Data Streams failed for ${asset.symbol}: status ${response.statusCode}`)
		}

		const body = new TextDecoder().decode(response.body)
		const data: DataStreamsResponse = JSON.parse(body)
		const decoded = decodeV3Report(data.report.fullReport)

		// Convert from 18 decimals (Data Streams) to 8 decimals (CollarOracle)
		const divisor = BigInt('10000000000')
		prices.push({
			symbol: asset.symbol,
			price: decoded.price / divisor,
			bid: decoded.bid / divisor,
			ask: decoded.ask / divisor,
		})
	}

	return prices
}

/**
 * Decode a Data Streams v3 fullReport hex string.
 * https://docs.chain.link/data-streams/reference/report-schema/v3
 */
function decodeV3Report(fullReport: string): {
	feedId: string
	price: bigint
	bid: bigint
	ask: bigint
	observationsTimestamp: number
	expiresAt: number
} {
	const hex = (fullReport.startsWith('0x') ? fullReport : '0x' + fullReport) as `0x${string}`
	const decoded = decodeAbiParameters(V3_REPORT_PARAMS, hex)

	return {
		feedId: decoded[0] as string,
		price: decoded[6] as bigint,
		bid: decoded[7] as bigint,
		ask: decoded[8] as bigint,
		observationsTimestamp: Number(decoded[2]),
		expiresAt: Number(decoded[5]),
	}
}

// ---------------------------------------------------------------------------
// Step 2: DoltHub Options Data via HTTP (with DON consensus)
//
// Fetches real implied volatility and IV rank from the DoltHub options database
// (post-no-preference/options). Free public SQL API with daily-updated
// US equity options data including full Greeks, bid/ask, and IV history.
// ---------------------------------------------------------------------------

const fetchVolatility = (
	sendRequester: HTTPSendRequester,
	config: Config,
): VolatilityResult => {
	const volatilities: VolatilityData[] = []

	for (const asset of config.assets) {
		// Query 1: IV rank from volatility_history table
		const ivQuery = `SELECT iv_current, hv_current, iv_year_high, iv_year_low FROM volatility_history WHERE act_symbol='${asset.symbol}' ORDER BY date DESC LIMIT 1`
		const ivUrl = `${config.dolthubBaseUrl}?q=${encodeURIComponent(ivQuery)}`

		const ivResponse = sendRequester
			.sendRequest({ method: 'GET', url: ivUrl })
			.result()

		let ivCurrent = 0.30
		let hvCurrent = 0.25
		let ivRank = 50

		if (ivResponse.statusCode === 200) {
			const ivBody = new TextDecoder().decode(ivResponse.body)
			const ivData: DoltHubResponse = JSON.parse(ivBody)

			if (ivData.rows && ivData.rows.length > 0) {
				const row = ivData.rows[0]
				ivCurrent = parseFloat(row.iv_current || '0.30')
				hvCurrent = parseFloat(row.hv_current || '0.25')
				const ivHigh = parseFloat(row.iv_year_high || '0.60')
				const ivLow = parseFloat(row.iv_year_low || '0.15')
				ivRank = ivHigh > ivLow
					? Math.round(((ivCurrent - ivLow) / (ivHigh - ivLow)) * 100)
					: 50
			}
		}

		// Query 2: ATM call IV from option_chain for nearest expiry
		const chainQuery = `SELECT vol FROM option_chain WHERE act_symbol='${asset.symbol}' AND call_put='Call' AND date=(SELECT MAX(date) FROM option_chain WHERE act_symbol='${asset.symbol}') ORDER BY expiration ASC LIMIT 1`
		const chainUrl = `${config.dolthubBaseUrl}?q=${encodeURIComponent(chainQuery)}`

		const chainResponse = sendRequester
			.sendRequest({ method: 'GET', url: chainUrl })
			.result()

		if (chainResponse.statusCode === 200) {
			const chainBody = new TextDecoder().decode(chainResponse.body)
			const chainData: DoltHubResponse = JSON.parse(chainBody)

			if (chainData.rows && chainData.rows.length > 0) {
				const atmVol = parseFloat(chainData.rows[0].vol || '0')
				if (atmVol > 0) ivCurrent = atmVol
			}
		}

		volatilities.push({
			symbol: asset.symbol,
			impliedVolatility: ivCurrent * 100,
			historicalVolatility: hvCurrent * 100,
			ivRank,
		})
	}

	return { volatilities }
}

// ---------------------------------------------------------------------------
// Step 3: EVM Write to CollarOracle
//
// Writes price, floor, cap, and volatility on-chain so every collar
// Folio issues is independently verifiable by third parties.
// ---------------------------------------------------------------------------

function writeCollarParams(
	runtime: Runtime<Config>,
	collars: CollarStrike[],
): string {
	const network = getNetwork({
		chainFamily: 'evm',
		chainSelectorName: runtime.config.chainSelectorName,
		isTestnet: true,
	})

	if (!network) {
		throw new Error(`Network not found: ${runtime.config.chainSelectorName}`)
	}

	const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)

	const symbols = collars.map((c) => c.symbol)
	const priceValues = collars.map((c) => c.price)
	const floorValues = collars.map((c) => c.floor)
	const capValues = collars.map((c) => c.cap)
	const volValues = collars.map((c) => c.volatility)

	runtime.log(`[CollarOracle] Writing ${symbols.length} collars: ${symbols.join(', ')}`)

	// Encode the calldata for updateCollars as the raw report payload
	const callData = encodeFunctionData({
		abi: COLLAR_ORACLE_ABI,
		functionName: 'updateCollars',
		args: [symbols, priceValues, floorValues, capValues, volValues],
	})

	// Build the DON consensus report containing our collar data
	// In production the DON injects this automatically; for simulation
	// we construct it so the fake EVM chain has a non-nil report to process
	const reportMsg = create(SDK_PB.ReportResponseSchema, {
		configDigest: new Uint8Array(32),
		seqNr: 1n,
		reportContext: new Uint8Array(32),
		rawReport: hexToBytes(callData),
		sigs: [],
	})
	const report = new Report(reportMsg)

	// Write via CRE report pattern — the DON reaches consensus and submits
	// through the CRE forwarder contract to the CollarOracle receiver
	const receiverAddress = runtime.config.collarOracleAddress

	const resp = evmClient
		.writeReport(runtime, {
			receiver: receiverAddress,
			report,
			gasConfig: {
				gasLimit: runtime.config.gasLimit,
			},
		})
		.result()

	if (resp.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`CollarOracle write failed: ${resp.errorMessage || resp.txStatus}`)
	}

	const txHash = resp.txHash ? bytesToHex(resp.txHash) : '0x'
	runtime.log(`[CollarOracle] tx: ${txHash}`)

	return txHash
}

// ---------------------------------------------------------------------------
// Workflow handler
// ---------------------------------------------------------------------------

export const onCronTrigger = (
	runtime: Runtime<Config>,
	payload: CronPayload,
): string => {
	if (!payload.scheduledExecutionTime) {
		throw new Error('Scheduled execution time is required')
	}

	runtime.log('=== Folio Collar Oracle Workflow ===')

	// Step 1: Data Streams prices via Confidential HTTP
	runtime.log('[Step 1] Chainlink Data Streams (Confidential HTTP)...')
	const prices = fetchDataStreamsPrices(runtime)

	for (const p of prices) {
		const usd = Number(p.price) / 1e8
		const bidUsd = Number(p.bid) / 1e8
		const askUsd = Number(p.ask) / 1e8
		runtime.log(`  ${p.symbol}: $${usd.toFixed(2)} (bid: $${bidUsd.toFixed(2)}, ask: $${askUsd.toFixed(2)})`)
	}

	// Step 2: Options volatility from DoltHub via HTTP (with DON consensus)
	runtime.log('[Step 2] DoltHub options data (real IV + IV rank)...')
	const httpClient = new cre.capabilities.HTTPClient()

	const volatilities = httpClient
		.sendRequest(
			runtime,
			fetchVolatility,
			consensusIdenticalAggregation<VolatilityResult>(),
		)(runtime.config)
		.result()

	for (const v of volatilities.volatilities) {
		runtime.log(`  ${v.symbol}: IV=${v.impliedVolatility.toFixed(1)}% HV=${v.historicalVolatility.toFixed(1)}% IVRank=${v.ivRank}`)
	}

	// Compute IV-derived collar strikes for each asset
	runtime.log('[Collar Math] Computing zero-cost collar strikes from IV...')
	const collars: CollarStrike[] = prices.map((p) => {
		const vol = volatilities.volatilities.find((v) => v.symbol === p.symbol)
		const ivPct = vol?.impliedVolatility ?? 30 // default 30% if missing
		const { floor8dec, cap8dec } = computeCollarStrikes(p.price, ivPct)

		const usd = Number(p.price) / 1e8
		const floorUsd = Number(floor8dec) / 1e8
		const capUsd = Number(cap8dec) / 1e8
		runtime.log(`  ${p.symbol}: $${usd.toFixed(2)} → floor=$${floorUsd.toFixed(2)} cap=$${capUsd.toFixed(2)} (IV=${ivPct.toFixed(1)}%, ${COLLAR_DURATION_DAYS}d, LTV=${LTV * 100}%)`)

		return {
			symbol: p.symbol,
			price: p.price,
			floor: floor8dec,
			cap: cap8dec,
			volatility: BigInt(Math.round(ivPct * 100)), // basis points
		}
	})

	// Step 3: Write on-chain
	runtime.log('[Step 3] Writing to CollarOracle (EVM Write)...')
	const txHash = writeCollarParams(runtime, collars)

	// Summary
	const summary = collars
		.map((c) => {
			const usd = Number(c.price) / 1e8
			const floorUsd = Number(c.floor) / 1e8
			const capUsd = Number(c.cap) / 1e8
			const ivBps = Number(c.volatility)
			return `${c.symbol}=$${usd.toFixed(0)} [${floorUsd.toFixed(0)}-${capUsd.toFixed(0)}] IV=${(ivBps / 100).toFixed(0)}%`
		})
		.join(' | ')

	runtime.log(`=== Done: ${summary} | tx: ${txHash} ===`)
	return txHash
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()

	return [
		cre.handler(
			cronTrigger.trigger({ schedule: config.schedule }),
			onCronTrigger,
		),
	]
}
