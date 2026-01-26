const jwt = require('jsonwebtoken');

const SECRET = 'dev-secret';
const token = jwt.sign({ sub: '0x123', role: 'listener' }, SECRET);

async function test() {
    try {
        const response = await fetch('http://localhost:3000/artists/me', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        console.log('Status:', response.status);
        const data = await response.json();
        console.log('Data:', data);
    } catch (err) {
        console.error('Error:', err.message);
    }
}

test();
