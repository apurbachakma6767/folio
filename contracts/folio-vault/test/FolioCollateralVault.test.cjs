const { expect } = require("chai");
const hre = require("hardhat");

describe("FolioCollateralVault", function () {
  it("deposit pulls tokens after approve", async function () {
    const [operator, user] = await hre.ethers.getSigners();
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy();
    const Vault = await hre.ethers.getContractFactory("FolioCollateralVault");
    const vault = await Vault.deploy(operator.address);

    await token.mint(user.address, 1_000_000n);
    await token.connect(user).approve(vault.target, 500_000n);
    await vault.connect(user).deposit(token.target, 500_000n);

    expect(await token.balanceOf(vault.target)).to.equal(500_000n);
    expect(await token.balanceOf(user.address)).to.equal(500_000n);
  });

  it("release sends tokens back (operator only)", async function () {
    const [operator, user, other] = await hre.ethers.getSigners();
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy();
    const Vault = await hre.ethers.getContractFactory("FolioCollateralVault");
    const vault = await Vault.deploy(operator.address);

    await token.mint(user.address, 1_000_000n);
    await token.connect(user).approve(vault.target, 400_000n);
    await vault.connect(user).deposit(token.target, 400_000n);

    await expect(vault.connect(other).release(token.target, user.address, 100_000n)).to.be.reverted;

    await vault.connect(operator).release(token.target, user.address, 100_000n);
    expect(await token.balanceOf(user.address)).to.equal(700_000n);
    expect(await token.balanceOf(vault.target)).to.equal(300_000n);
  });
});
