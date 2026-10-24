/**
 * Generated from SplitMarketplaceHarness.sol (#2172); see the header there.
 * solc 0.8.28 --evm-version paris --optimize. Test-only, never deployed.
 */
export const SPLIT_MARKETPLACE_HARNESS_ABI = [
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "feeBps",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "feeRecipient",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "recipient",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "RoyaltyPaid",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "listingId",
        "type": "uint256"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "buyer",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "totalPaid",
        "type": "uint256"
      }
    ],
    "name": "Sold",
    "type": "event"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "listingId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "seller",
        "type": "address"
      }
    ],
    "name": "buy",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256[]",
        "name": "listingIds",
        "type": "uint256[]"
      },
      {
        "internalType": "uint256[]",
        "name": "tokenIds",
        "type": "uint256[]"
      },
      {
        "internalType": "address[]",
        "name": "sellers",
        "type": "address[]"
      },
      {
        "internalType": "uint256[]",
        "name": "prices",
        "type": "uint256[]"
      }
    ],
    "name": "buyBatch",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "protocolFeeBps",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "protocolFeeRecipient",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "royaltyBps",
    "outputs": [
      {
        "internalType": "uint96",
        "name": "",
        "type": "uint96"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      },
      {
        "internalType": "uint256",
        "name": "salePrice",
        "type": "uint256"
      }
    ],
    "name": "royaltyInfo",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      },
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "name": "royaltyReceiver",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "feeBps",
        "type": "uint256"
      }
    ],
    "name": "setProtocolFee",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "tokenId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "internalType": "uint96",
        "name": "bps",
        "type": "uint96"
      }
    ],
    "name": "setRoyalty",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

export const SPLIT_MARKETPLACE_HARNESS_BYTECODE = "0x6080604052348015600f57600080fd5b506040516108dd3803806108dd833981016040819052602c916055565b600091909155600180546001600160a01b0319166001600160a01b039092169190911790556090565b60008060408385031215606757600080fd5b825160208401519092506001600160a01b0381168114608557600080fd5b809150509250929050565b61083e8061009f6000396000f3fe6080604052600436106100865760003560e01c80635cd2dd5e116100595780635cd2dd5e1461015657806364df049e146101a4578063787dce3d146101c457806380c8d690146101e4578063b7de9ec81461025957600080fd5b80632a55205a1461008b5780632bc911e5146100cf57806335659fb81461011d57806359a87bc114610141575b600080fd5b34801561009757600080fd5b506100ab6100a6366004610561565b61026c565b604080516001600160a01b0390931683526020830191909152015b60405180910390f35b3480156100db57600080fd5b506101056100ea366004610583565b6003602052600090815260409020546001600160601b031681565b6040516001600160601b0390911681526020016100c6565b34801561012957600080fd5b5061013360005481565b6040519081526020016100c6565b61015461014f3660046105b8565b6102bf565b005b34801561016257600080fd5b5061018c610171366004610583565b6002602052600090815260409020546001600160a01b031681565b6040516001600160a01b0390911681526020016100c6565b3480156101b057600080fd5b5060015461018c906001600160a01b031681565b3480156101d057600080fd5b506101546101df366004610583565b600055565b3480156101f057600080fd5b506101546101ff3660046105ed565b600092835260026020908152604080852080546001600160a01b0319166001600160a01b03959095169490941790935560039052912080546bffffffffffffffffffffffff19166001600160601b03909216919091179055565b61015461026736600461067e565b6102d0565b600082815260026020908152604080832054600390925282205482916001600160a01b031690612710906102a9906001600160601b03168661076b565b6102b39190610788565b915091505b9250929050565b6102cb838383346103cc565b505050565b6000805b88811015610384578383828181106102ee576102ee6107aa565b905060200201358261030091906107c0565b915061037c8a8a83818110610317576103176107aa565b90506020020135898984818110610330576103306107aa565b90506020020135888885818110610349576103496107aa565b905060200201602081019061035e91906107d3565b878786818110610370576103706107aa565b905060200201356103cc565b6001016102d4565b503481146103c15760405162461bcd60e51b815260206004820152600560248201526476616c756560d81b60448201526064015b60405180910390fd5b505050505050505050565b6000806103d9858461026c565b915091506000612710600054856103f0919061076b565b6103fa9190610788565b905060008161040984876107f5565b61041391906107f5565b9050821561046a5761042584846104d8565b836001600160a01b0316877ff670029fc6f5302baba881b4ae845d1453acdf752b4c19ed81fe0fa6a686409b8560405161046191815260200190565b60405180910390a35b811561048657600154610486906001600160a01b0316836104d8565b61049086826104d8565b60408051600181526020810187905233918a917fcd1c39d27a443bebce7f2cf1cb49519e7586ec24d1a7a7c9fcc00f57cd8efbfb910160405180910390a35050505050505050565b6000826001600160a01b03168260405160006040518083038185875af1925050503d8060008114610525576040519150601f19603f3d011682016040523d82523d6000602084013e61052a565b606091505b50509050806102cb5760405162461bcd60e51b815260206004820152600360248201526270617960e81b60448201526064016103b8565b6000806040838503121561057457600080fd5b50508035926020909101359150565b60006020828403121561059557600080fd5b5035919050565b80356001600160a01b03811681146105b357600080fd5b919050565b6000806000606084860312156105cd57600080fd5b83359250602084013591506105e46040850161059c565b90509250925092565b60008060006060848603121561060257600080fd5b833592506106126020850161059c565b915060408401356001600160601b038116811461062e57600080fd5b809150509250925092565b60008083601f84011261064b57600080fd5b50813567ffffffffffffffff81111561066357600080fd5b6020830191508360208260051b85010111156102b857600080fd5b6000806000806000806000806080898b03121561069a57600080fd5b883567ffffffffffffffff8111156106b157600080fd5b6106bd8b828c01610639565b909950975050602089013567ffffffffffffffff8111156106dd57600080fd5b6106e98b828c01610639565b909750955050604089013567ffffffffffffffff81111561070957600080fd5b6107158b828c01610639565b909550935050606089013567ffffffffffffffff81111561073557600080fd5b6107418b828c01610639565b999c989b5096995094979396929594505050565b634e487b7160e01b600052601160045260246000fd5b808202811582820484141761078257610782610755565b92915050565b6000826107a557634e487b7160e01b600052601260045260246000fd5b500490565b634e487b7160e01b600052603260045260246000fd5b8082018082111561078257610782610755565b6000602082840312156107e557600080fd5b6107ee8261059c565b9392505050565b818103818111156107825761078261075556fea264697066735822122080b39342721f1f53e0bb2316d639683ce896b4d125450735d13727bbe10797eb64736f6c634300081c0033" as const;
