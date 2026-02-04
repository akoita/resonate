
// Bypass TLS validation for direct IP connections (common dev fix)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import * as dns from 'dns';
import * as util from 'util';
import { LitNodeClientNodeJs } from '@lit-protocol/lit-node-client-nodejs';

const lookup = util.promisify(dns.lookup);

async function diagnose() {
    console.log("=== Lit Protocol Connectivity Diagnosis (TLS Disabled) ===");

    // 1. DNS Resolution Check
    const domain = 'datil-test-rpc.litprotocol.com';
    console.log(`\n[1] Checking DNS resolution for ${domain}...`);
    try {
        const result = await lookup(domain);
        console.log(`✅ DNS Resolved: ${result.address}`);
    } catch (error: any) {
        console.error(`❌ DNS Resolution Failed: ${error.message}`);
    }

    // 2. HTTP Fetch Check (RPC)
    console.log(`\n[2] Checking HTTP connectivity to RPC (${domain})...`);
    try {
        const response = await fetch(`https://${domain}`, { method: 'HEAD' });
        console.log(`✅ HTTP Connection Successful: Status ${response.status}`);
    } catch (error: any) {
        console.error(`❌ HTTP Connection Failed: ${error.message}`);
    }

    // 3. SDK Connection Check (Datil Test)
    console.log(`\n[3] Testing Lit SDK Connection (datil-test)...`);
    const client = new LitNodeClientNodeJs({
        alertWhenUnauthorized: false,
        litNetwork: 'datil-test' as any,
        debug: true
    });

    try {
        console.log("Connecting...");
        await client.connect();
        console.log("✅ SDK Connected Successfully!");
    } catch (error: any) {
        console.error(`❌ SDK Connection Failed: ${error.message}`);
    }

    // 4. Test Datil Dev Network
    console.log(`\n[4] Testing Lit SDK Connection (datil-dev)...`);
    const devClient = new LitNodeClientNodeJs({
        alertWhenUnauthorized: false,
        litNetwork: 'datil-dev' as any,
        debug: true
    });

    try {
        console.log("Connecting to Datil Dev...");
        await devClient.connect();
        console.log("✅ SDK Connected to Datil Dev Successfully!");
    } catch (error: any) {
        console.error(`❌ SDK Connection to Datil Dev Failed: ${error.message}`);
    }

    // 5. Test Datil Mainnet
    console.log(`\n[5] Testing Lit SDK Connection (datil - mainnet)...`);
    const mainClient = new LitNodeClientNodeJs({
        alertWhenUnauthorized: false,
        litNetwork: 'datil' as any,
        debug: true
    });

    try {
        console.log("Connecting to Datil Mainnet...");
        await mainClient.connect();
        console.log("✅ SDK Connected to Datil Mainnet Successfully!");
    } catch (error: any) {
        console.error(`❌ SDK Connection to Datil Mainnet Failed: ${error.message}`);
    }
}

diagnose();
