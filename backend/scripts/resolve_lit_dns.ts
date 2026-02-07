
import { Resolver } from 'dns';
const resolver = new Resolver();
resolver.setServers(['8.8.8.8', '1.1.1.1']);

const domains = [
    'datil-test-rpc.litprotocol.com',
    'datil-dev-rpc.litprotocol.com',
    'datil-rpc.litprotocol.com',
    'chronicle-yellowstone-rpc.litprotocol.com'
];

async function resolveAll() {
    for (const domain of domains) {
        try {
            const addresses = await new Promise((resolve, reject) => {
                resolver.resolve4(domain, (err, addresses) => {
                    if (err) reject(err);
                    else resolve(addresses);
                });
            });
            console.log(`✅ ${domain}: ${addresses}`);
        } catch (error: any) {
            console.error(`❌ ${domain}: ${error.message}`);
        }
    }
}

resolveAll();
