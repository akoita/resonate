#!/bin/bash
SALT=$(cast keccak $(cast abi-encode "f(string)" "resonate:0xa960e59b03c4a8bac509fb59aa207367fa72dd1c"))
VALIDATOR=0xdc64a140aa3e981100a9beca4e685f962f0cf6c9
OWNER=0xa960e59b03c4a8bac509fb59aa207367fa72dd1c
ROOT_VAL="0x01dc64a140aa3e981100a9beca4e685f962f0cf6c9"
HOOK=0x0000000000000000000000000000000000000000
INIT_DATA=$(cast abi-encode "initialize(bytes21,address,bytes,bytes,bytes[])" $ROOT_VAL $HOOK $OWNER "0x" "[]")
FACTORY=0xcf7ed3acca5a467e9e704c703e8d87f634fb0fc9
PREDICTED=$(cast call $FACTORY "getAddress(bytes,bytes32)(address)" $INIT_DATA $SALT --rpc-url http://localhost:8545)
echo "New Predicted Address: $PREDICTED"
cast send $PREDICTED --value 1ether --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
