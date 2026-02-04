
import * as dns from 'dns';
import * as util from 'util';

const lookup = util.promisify(dns.lookup);

async function checkDns() {
    const domains = [
        'datil-test-rpc.litprotocol.com',
        'datil-rpc.litprotocol.com',
        'datil-dev-rpc.litprotocol.com',
        'google.com'
    ];

    for (const domain of domains) {
        try {
            const result = await lookup(domain);
            console.log(`✅ ${domain}: ${result.address}`);
        } catch (error: any) {
            console.error(`❌ ${domain}: ${error.message}`);
        }
    }
}

checkDns();
