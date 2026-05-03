// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {CollarOracle} from "contracts/CollarOracle.sol";

/**
 * @notice Registers Chainlink Price Feed addresses on the deployed CollarOracle.
 *         This enables on-chain price verification via getLatestPrice().
 *
 * Usage:
 *   forge script chainlink/contracts/SetPriceFeeds.s.sol \
 *     --rpc-url https://sepolia.base.org \
 *     --broadcast --private-key $DEPLOYER_PRIVATE_KEY
 *
 * Base Sepolia Chainlink Price Feed addresses:
 *   ETH/USD: 0x4ADc67d868c6e4DD3e6b5c09f2CD64B14C0d942C
 *   (Stock feeds not yet available on Base Sepolia — using ETH/USD as proxy for demo)
 */
contract SetPriceFeeds is Script {
    // Deployed CollarOracle on Base Sepolia
    address constant COLLAR_ORACLE = 0x00A3cF51bA20eA6f1754BaFcecA6d144e3d1D00f;

    // Chainlink Price Feeds on Base Sepolia
    // https://docs.chain.link/data-feeds/price-feeds/addresses?network=base&page=1#base-sepolia-testnet
    address constant ETH_USD_FEED = 0x4ADc67d868c6e4DD3e6b5c09f2CD64B14C0d942C;

    function run() external {
        vm.startBroadcast();

        CollarOracle oracle = CollarOracle(COLLAR_ORACLE);

        // Register ETH/USD feed for both assets (proxy for demo — real stock feeds
        // would use Data Streams via the CRE workflow, which writes directly via updateCollars)
        oracle.setPriceFeed("AAPL", ETH_USD_FEED);
        oracle.setPriceFeed("TSLA", ETH_USD_FEED);

        vm.stopBroadcast();
    }
}
