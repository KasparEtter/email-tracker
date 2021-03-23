import http from 'http';
import https from 'https';
import WebSocket from 'ws';

function fetchRemoteFile(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        https.get(url, (response: http.IncomingMessage) => {
            let data = '';
            response.on('data', (chunk) => {
                data += chunk;
            });
            response.on('end', () => {
                resolve(data);
            });
        }).on('error', (error: Error) => {
            reject(error);
        });
    });
}

const pixel = [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
    0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
    0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x09, 0x70, 0x48, 0x59, 0x73, 0x00, 0x00, 0x0b, 0x12, 0x00,
    0x00, 0x0b, 0x12, 0x01, 0xd2, 0xdd, 0x7e, 0xfc, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54,
    0x08, 0xd7, 0x63, 0x60, 0x00, 0x02, 0x00, 0x00, 0x05, 0x00, 0x01, 0xe2, 0x26, 0x05, 0x9b, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82 ]; // 89 bytes

const buffer = Buffer.from(pixel);

const sockets: { [key: string]: WebSocket | undefined } = {};

function notify(request: http.IncomingMessage, token: string, target: string): void {
    const socket = sockets[token];
    if (socket !== undefined) {
        const address = (request.headers['x-forwarded-for'] as string).split(',')[0];
        const client = request.headers['user-agent'];
        socket.send(JSON.stringify({ target, address, client }));
    }
}

const server = http.createServer(async (request, response) => {
    const path = request.url!;
    if (/^\/[a-zA-Z0-9]+\.png$/.test(path)) {
        const token = path.slice(1, -4);
        notify(request, token, 'Image');
        response.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': pixel.length,
        });
        response.write(buffer);
        response.end();
    } else if (/^\/[a-zA-Z0-9]+\/.*$/.test(path)) {
        const index = path.indexOf('/', 1);
        const token = path.substring(1, index);
        const link = path.substring(index + 1);
        notify(request, token, 'Link');
        response.writeHead(307, {
            'Location': decodeURIComponent(link),
        });
        response.end();
    } else if (/^\/mta-sts\.txt\?domain=([a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?\.)+[a-z][-a-z0-9]{0,61}[a-z0-9]$/.test(path)) {
        try {
            const domain = path.split('=')[1];
            const url = 'https://mta-sts.' + domain + '/.well-known/mta-sts.txt';
            const file = await fetchRemoteFile(url);
            response.writeHead(200, {
                'Content-Type': 'text/plain',
                'Content-Length': file.length,
                'Content-Disposition': 'inline',
                'Access-Control-Allow-Origin': '*',
            });
            response.write(file);
            response.end();
        } catch (error) {
            response.writeHead(404);
            response.end();
        }
    } else {
        response.writeHead(404);
        response.end();
    }
}).listen(process.env.PORT ?? 5000);

const webSocketServer = new WebSocket.Server({ server });

webSocketServer.on('connection', (socket, request) => {
    const path = request.url;
    if (path && /^\/[a-z0-9]+$/i.test(path)) {
        const token = path.substring(1);
        const previousSocket = sockets[token];
        if (previousSocket !== undefined) {
            // https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Status_codes
            previousSocket.close(1001, 'Another client subscribed to this token.');
        }
        sockets[token] = socket;
        socket.on('close', () => sockets[token] = undefined);
    } else {
        socket.close();
    }
});
