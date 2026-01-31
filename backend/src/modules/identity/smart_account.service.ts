import {
    createPublicClient,
    http,
    encodeFunctionData,
    keccak256,
    encodeAbiParameters,
    parseAbiParameters,
    Hex,
    Address,
} from "viem";

// Kernel initialization types
export interface KernelInitData {
    owner: Address;
    validatorAddress: Address;
}

// ABI for KernelFactory
const KERNEL_FACTORY_ABI = [
    {
        name: "createAccount",
        type: "function",
        inputs: [
            { name: "data", type: "bytes" },
            { name: "salt", type: "bytes32" },
        ],
        outputs: [{ name: "", type: "address" }],
        stateMutability: "payable",
    },
    {
        name: "getAddress",
        type: "function",
        inputs: [
            { name: "data", type: "bytes" },
            { name: "salt", type: "bytes32" },
        ],
        outputs: [{ name: "", type: "address" }],
        stateMutability: "view",
    },
    {
        name: "implementation",
        type: "function",
        inputs: [],
        outputs: [{ name: "", type: "address" }],
        stateMutability: "view",
    },
] as const;

// Kernel initialize function ABI (simplified - sets ECDSA validator as root)
const KERNEL_INIT_ABI = [
    {
        name: "initialize",
        type: "function",
        inputs: [
            { name: "initialValidator", type: "address" },
            { name: "initialValidatorData", type: "bytes" },
        ],
        outputs: [],
        stateMutability: "nonpayable",
    },
] as const;

export class SmartAccountService {
    private readonly rpcUrl: string;
    private readonly factoryAddress: Address;
    private readonly ecdsaValidatorAddress: Address;

    constructor(config: {
        rpcUrl: string;
        factoryAddress: Address;
        ecdsaValidatorAddress: Address;
    }) {
        this.rpcUrl = config.rpcUrl;
        this.factoryAddress = config.factoryAddress;
        this.ecdsaValidatorAddress = config.ecdsaValidatorAddress;
    }

    /**
     * Build the initialization data for Kernel
     * This sets up the ECDSA validator with the owner's address
     */
    buildKernelInitData(owner: Address): Hex {
        // The validator data for ECDSA is just the owner's address (20 bytes)
        const validatorData = owner;

        return encodeFunctionData({
            abi: KERNEL_INIT_ABI,
            functionName: "initialize",
            args: [this.ecdsaValidatorAddress, validatorData],
        });
    }

    /**
     * Compute the salt from user-specific data
     */
    computeSalt(userId: string, saltPrefix: string = "resonate"): Hex {
        const input = `${saltPrefix}:${userId}`;
        return keccak256(
            encodeAbiParameters(parseAbiParameters("string"), [input])
        );
    }

    /**
     * Build the factoryData for createAccount call
     */
    buildFactoryData(initData: Hex, salt: Hex): Hex {
        return encodeFunctionData({
            abi: KERNEL_FACTORY_ABI,
            functionName: "createAccount",
            args: [initData, salt],
        });
    }

    /**
     * Get the counterfactual address by calling factory.getAddress()
     */
    async getCounterfactualAddress(
        owner: Address,
        userId: string
    ): Promise<Address> {
        const client = createPublicClient({
            transport: http(this.rpcUrl),
        });

        const initData = this.buildKernelInitData(owner);
        const salt = this.computeSalt(userId);

        const address = await client.readContract({
            address: this.factoryAddress,
            abi: KERNEL_FACTORY_ABI,
            functionName: "getAddress",
            args: [initData, salt],
        });

        return address;
    }

    /**
     * Get all the data needed for smart account deployment
     */
    async getDeploymentInfo(owner: Address, userId: string) {
        const initData = this.buildKernelInitData(owner);
        const salt = this.computeSalt(userId);
        const factoryData = this.buildFactoryData(initData, salt);
        const counterfactualAddress = await this.getCounterfactualAddress(
            owner,
            userId
        );

        return {
            sender: counterfactualAddress,
            factory: this.factoryAddress,
            factoryData,
            initData,
            salt,
        };
    }
}
