// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import {MockUSDC} from "contracts/MockUSDC.sol";

/**
 * @notice Mint MockUSDC to the Dynamic server wallet on Base Sepolia.
 *
 * Usage:
 *   DYNAMIC_SERVER_WALLET_ADDRESS=0x... forge script chainlink/contracts/MintMockUSDC.s.sol \
 *     --rpc-url https://sepolia.base.org \
 *     --broadcast --private-key $BASE_SEPOLIA_PRIVATE_KEY
 */
contract MintMockUSDC is Script {
    address constant MOCK_USDC = 0x3BE24eC5d3600dFd8abd854CC5Db8e07B4dd3E8c;

    function run() external {
        address serverWallet = vm.envAddress("DYNAMIC_SERVER_WALLET_ADDRESS");
        require(serverWallet != address(0), "Set DYNAMIC_SERVER_WALLET_ADDRESS env var");

        vm.startBroadcast();

        MockUSDC usdc = MockUSDC(MOCK_USDC);
        usdc.mint(serverWallet, 10_000_000_000); // 10,000 USDC (6 decimals)

        vm.stopBroadcast();

        console.log("Minted 10,000 USDC to server wallet:", serverWallet);
    }
}
