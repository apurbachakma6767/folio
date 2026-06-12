// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "./CollarOracle.sol";
import "./MockUSDC.sol";

/**
 * @title DeployToHedera
 * @notice Deploys CollarOracle and MockUSDC to Hedera Testnet
 * @dev Uses Foundry with Hedera's EVM-compatible JSON-RPC (HashIO)
 * 
 * Run with:
 *   forge script DeployToHedera --rpc-url $HEDERA_TESTNET_RPC_URL --broadcast --private-key $CRE_ETH_PRIVATE_KEY
 * 
 * Environment variables needed:
 *   - HEDERA_TESTNET_RPC_URL: https://testnet.hashio.io/api
 *   - CRE_ETH_PRIVATE_KEY: Your Hedera EVM private key (64-char hex, no 0x prefix)
 */
contract DeployToHedera is Script {
    function run() external {
        // Load private key from environment
        uint256 deployerPrivateKey = vm.envUint("CRE_ETH_PRIVATE_KEY");
        
        // Start broadcasting transactions
        vm.startBroadcast(deployerPrivateKey);

        console.log("Deploying to Hedera Testnet...");
        console.log("Chain ID:", block.chainid);

        // Deploy MockUSDC first
        MockUSDC mockUSDC = new MockUSDC();
        console.log("MockUSDC deployed at:", address(mockUSDC));

        // Deploy CollarOracle with a temporary forwarder address
        // The forwarder will be updated later to the CRE forwarder address
        address temporaryForwarder = vm.addr(deployerPrivateKey);
        CollarOracle collarOracle = new CollarOracle(temporaryForwarder);
        console.log("CollarOracle deployed at:", address(collarOracle));

        // Log deployment info
        console.log("\n=== DEPLOYMENT SUMMARY ===");
        console.log("Network: Hedera Testnet");
        console.log("Chain ID: 296");
        console.log("MockUSDC:", address(mockUSDC));
        console.log("CollarOracle:", address(collarOracle));
        console.log("Initial Forwarder:", temporaryForwarder);
        console.log("\nNext steps:");
        console.log("1. Update COLLAR_ORACLE_ADDRESS in .env.local");
        console.log("2. Update config files with new contract address");
        console.log("3. Set the CRE forwarder address in CollarOracle");
        console.log("4. Deploy workflow to CRE and get the actual forwarder address");

        vm.stopBroadcast();
    }
}

/**
 * @title UpdateForwarder
 * @notice Updates the forwarder address in CollarOracle after CRE deployment
 * 
 * Run with:
 *   forge script UpdateForwarder --rpc-url $HEDERA_TESTNET_RPC_URL --broadcast --private-key $CRE_ETH_PRIVATE_KEY
 */
contract UpdateForwarder is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("CRE_ETH_PRIVATE_KEY");
        address collarOracleAddress = vm.envAddress("COLLAR_ORACLE_ADDRESS");
        address newForwarder = vm.envAddress("CRE_FORWARDER_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        CollarOracle collarOracle = CollarOracle(collarOracleAddress);
        collarOracle.setForwarder(newForwarder);

        console.log("Updated forwarder to:", newForwarder);

        vm.stopBroadcast();
    }
}

/**
 * @title SetPriceFeed
 * @notice Sets Chainlink price feed addresses for assets in CollarOracle
 * 
 * Run with:
 *   forge script SetPriceFeed --rpc-url $HEDERA_TESTNET_RPC_URL --broadcast --private-key $CRE_ETH_PRIVATE_KEY
 */
contract SetPriceFeed is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("CRE_ETH_PRIVATE_KEY");
        address collarOracleAddress = vm.envAddress("COLLAR_ORACLE_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        CollarOracle collarOracle = CollarOracle(collarOracleAddress);

        // Set price feeds for supported assets
        // These are example addresses - replace with actual Hedera price feeds
        // Note: Hedera has Chainlink Data Streams, not traditional price feeds
        // The workflow uses Data Streams directly, so these are optional
        
        console.log("Price feeds can be set here if using traditional Chainlink feeds");
        console.log("For Data Streams, the workflow handles this directly");

        vm.stopBroadcast();
    }
}