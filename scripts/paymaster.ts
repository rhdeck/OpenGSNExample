// More info on GSN: https://docs.opengsn.org/#architecture
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { HardhatConfig, HardhatRuntimeEnvironment } from "hardhat/types";
import { task } from "hardhat/config";
import { PaymasterConfig } from "./paymasterConfig";
import { NovelPaymaster__factory } from "../typechain-types/factories/NovelPaymaster__factory";
// import {} from '../typechain-types/NovelPaymaster';
type PaymasterConstructorArguments = [
  RELAY_HUB_ADDRESS: string,
  GSN_TRUSTED_FORWARDER_ADDRESS: string
];
const deploy = async (
  hre: HardhatRuntimeEnvironment,
  {
    RELAY_HUB_ADDRESS,
    GSN_TRUSTED_FORWARDER_ADDRESS,
  }: { RELAY_HUB_ADDRESS: string; GSN_TRUSTED_FORWARDER_ADDRESS: string }
) => {
  if (!hre) throw new Error("hre is required");
  if (!RELAY_HUB_ADDRESS) throw new Error("Relay hub address is required");
  if (!GSN_TRUSTED_FORWARDER_ADDRESS)
    throw new Error("GSN trusted forwarder address is required");
  // Paymaster funds transactions
  const Paymaster = await hre.ethers.getContractFactory("NovelPaymaster");

  // Relay hub is starting the transaction (asks the NovelContract if the payment should
  // go through, and then passes on the transaction to the forwarder
  // The paymaster holds and hands out the gas needed for the transactions
  const paymaster = await Paymaster.deploy(
    RELAY_HUB_ADDRESS,
    GSN_TRUSTED_FORWARDER_ADDRESS
  );

  // wait for it to be deployed
  await paymaster.deployed();
  return {
    address: paymaster.address,
    constructorArguments: [
      RELAY_HUB_ADDRESS,
      GSN_TRUSTED_FORWARDER_ADDRESS,
    ] as PaymasterConstructorArguments,
  };
};

export const fill = async (
  hre: HardhatRuntimeEnvironment,
  eth: string,
  address?: string
) => {
  const paymaster = await get(hre, address);
  console.log("sending to paymasterAddress", paymaster.address);
  // process.exit();
  // console.log(Object.keys(paymaster));
  // process.exit();
  // const txHash = await paymaster.receive({
  //   value: hre.ethers.utils.parseEther(eth),
  // });

  const lastSigner = (await hre.ethers.getSigners()).pop();
  if (!lastSigner) throw new Error("no signers available");
  const gas_limit = 1e5;
  const gas_price = await hre.ethers.provider.getGasPrice();
  const params = {
    to: paymaster.address,
    value: hre.ethers.utils.parseEther(eth),
    nonce: await hre.ethers.provider.getTransactionCount(
      lastSigner.address,
      "latest"
    ),
    gasLimit: hre.ethers.utils.hexlify(gas_limit), // 100000
    gasPrice: hre.ethers.utils.hexlify(gas_price),
  };
  console.log("Running transaction with params", params);
  const txHash = await lastSigner.sendTransaction(params);
  await txHash.wait();
  return true;
};
const getPath = (hre: HardhatRuntimeEnvironment) =>
  join(__dirname, "..", `paymaster.${hre.network.name}.json`);

export const get = async (hre: HardhatRuntimeEnvironment, address?: string) => {
  if (!address) {
    const path = getPath(hre);
    if (!existsSync(path))
      throw new Error(
        "Could not find paymaster.json - try running hardhat deploy-paymaster"
      );
    const json = readFileSync(path, "utf8");
    const obj = JSON.parse(json);
    if (!obj.address)
      throw new Error(
        "Could not read paymaster.json - try running hardhat deploy-paymaster"
      );
    address = obj.address;
  }
  if (!address) throw new Error("Paymaster address is required");
  const paymaster = NovelPaymaster__factory.connect(
    address,
    hre.ethers.provider
  );
  console.log("Returning new world order paymaster", paymaster.address);
  return paymaster;
};

export const check = async (
  hre: HardhatRuntimeEnvironment,
  address: string
) => {
  const paymaster = await get(hre, address);
  const balance = await paymaster.getRelayHubDeposit();
  return balance;
};

export const verify = async (
  hre: HardhatRuntimeEnvironment,
  address: string,
  constructorArguments: PaymasterConstructorArguments
) => {
  const [RELAY_HUB_ADDRESS, GSN_TRUSTED_FORWARDER_ADDRESS] =
    constructorArguments;
  if (!RELAY_HUB_ADDRESS) throw new Error("Relay hub address is required");
  if (!GSN_TRUSTED_FORWARDER_ADDRESS)
    throw new Error("GSN trusted forwarder address is required");
  try {
    const output = await hre.run("verify:verify", {
      address,
      constructorArguments,
    });
    console.log("Verification successful: ", output);
  } catch (e) {
    // console.log("There was an error in the verification process");
    // console.log((e as Error).message);
    // console.log(Object.keys(e as Error));
    // console.log("Name", (e as Error).name);
    // console.log("--------");
    const message = (e as Error).message;
    if (message.includes("Reason: Already Verified")) {
      //This is fine
      console.log("Verification successful: Already verified");
    } else {
      throw e;
    }
  }
};

task("deploy-paymaster", "Deploys the paymaster")
  .addOptionalParam("verify", "Verify the contract after deploying")

  .setAction(async ({ verify: doVerify }, hre) => {
    const config = hre.config as PaymasterConfig<HardhatConfig>;
    const output = await deploy(hre, {
      RELAY_HUB_ADDRESS:
        config.paymasterInfo[hre.network.name].RELAY_HUB_ADDRESS,
      GSN_TRUSTED_FORWARDER_ADDRESS:
        config.paymasterInfo[hre.network.name].GSN_TRUSTED_FORWARDER_ADDRESS,
    });
    const path = getPath(hre);
    writeFileSync(path, JSON.stringify(output, null, 2));
    console.log("Paymaster deployed at", output.address);
    if (doVerify) {
      try {
        await verify(hre, output.address, output.constructorArguments);
      } catch (e) {
        console.warn("Could not verify paymaster", (e as Error).message);
      }
    }
  });

task("fill-paymaster", "Adds native token to paymaster")
  .addParam(
    "eth",
    "quantity in eth to add to the paymaster account - fractions allowed"
  )
  .setAction(async ({ eth }, hre: HardhatRuntimeEnvironment) => {
    if (isNaN(parseFloat(eth))) throw new Error("eth must be a number");
    if (parseFloat(eth) < 0.01) throw new Error("Minimum amount is 0.01 ETH");
    const output = await fill(hre, eth);
    console.log("Paymaster refilled");
  });

task("check-paymaster", "Check that a contract is whitelisted on the paymaster")
  .addParam("address", "address of the contract")
  .setAction(async ({ address }, hre: HardhatRuntimeEnvironment) => {
    const paymaster = await get(hre);
    const isWhitelisted = await paymaster.isEnabledContract(address);
    console.log("isWhitelisted", isWhitelisted);
  });
task("enable-paymaster", "Enable a contract on the paymaster")
  .addParam("address", "address of the contract")
  .setAction(async ({ address }, hre: HardhatRuntimeEnvironment) => {
    const [owner] = await hre.ethers.getSigners();
    const paymaster = await (await get(hre)).connect(owner);
    await paymaster.enableContract(address, {});
    console.log("Contract enabled");
  });
task(
  "verify-paymaster",
  "Verify that a contract is whitelisted on the paymaster"
)
  .addOptionalParam("path", "path to the contract")
  .setAction(async ({ path }, hre) => {
    if (!path) path = getPath(hre);
    else if (!path.startsWith("/")) path = join(process.cwd(), path);
    const { address, constructorArguments } = require(path);
    await verify(hre, address, constructorArguments);
  });

task("balance-paymaster", "Confirm deposited balance with the relayhub")
  .addOptionalParam("address", "address of the paymaster")
  .setAction(async ({ address }, hre: HardhatRuntimeEnvironment) => {
    const balance = await check(hre, address);
    console.log("Current balance in wei is ", balance.toString());
  });
