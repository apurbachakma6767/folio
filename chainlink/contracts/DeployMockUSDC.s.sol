// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {MockUSDC} from "contracts/MockUSDC.sol";

/**
 * @notice Deploy MockUSDC on Base Sepolia and mint to the Dynamic server wallet.
 *
 * Usage:
 *   forge script chainlink/contracts/DeployMockUSDC.s.sol \
 *     --rpc-url https://sepolia.base.org \
 *     --broadcast --private-key $DEPLOYER_PRIVATE_KEY
 *
 * After deploying, set MOCK_USDC_BASE_ADDRESS in .env.local to the logged address.
 */
contract DeployMockUSDC is Script {
    function run() external {
        // Read the Dynamic server wallet address from env (or use a default for testing)
        address serverWallet = vm.envOr("DYNAMIC_SERVER_WALLET_ADDRESS", address(0));

        vm.startBroadcast();

        MockUSDC usdc = new MockUSDC();

        // Mint 10,000 fUSDC to the deployer
        usdc.mint(msg.sender, 10_000_000_000); // 10,000 USDC (6 decimals)

        // If server wallet is set, mint to it too
        if (serverWallet != address(0)) {
            usdc.mint(serverWallet, 10_000_000_000);
        }

        vm.stopBroadcast();

        console.log("MockUSDC deployed at:", address(usdc));
        console.log("Minted 10,000 fUSDC to deployer:", msg.sender);
        if (serverWallet != address(0)) {
            console.log("Minted 10,000 fUSDC to server wallet:", serverWallet);
        }
        console.log("");
        console.log("Add to .env.local:");
        console.log("  MOCK_USDC_BASE_ADDRESS=", address(usdc));
    }
}
