import { ConnInfo, serve } from 'https://deno.land/std@0.166.0/http/server.ts';

const pixel = [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
    0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
    0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x09, 0x70, 0x48, 0x59, 0x73, 0x00, 0x00, 0x0b, 0x12, 0x00,
    0x00, 0x0b, 0x12, 0x01, 0xd2, 0xdd, 0x7e, 0xfc, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54,
    0x08, 0xd7, 0x63, 0x60, 0x00, 0x02, 0x00, 0x00, 0x05, 0x00, 0x01, 0xe2, 0x26, 0x05, 0x9b, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82 ]; // 89 bytes

const blob = new Blob([new Uint8Array(pixel)]);

const sockets: { [key: string]: WebSocket | undefined } = {};

// https://deno.com/deploy/docs/runtime-broadcast-channel
const channel = new BroadcastChannel('');

interface Message {
    token: string;
    data: string;
}

channel.onmessage = (event: MessageEvent<string>) => {
    const { token, data } = JSON.parse(event.data) as Message;
    sockets[token]?.send(data);
}

function notify(request: Request, connection: ConnInfo, token: string, target: string): void {
    // https://deno.com/deploy/docs/examples#client-ip
    const address = (connection.remoteAddr as Deno.NetAddr).hostname;
    const client = request.headers.get('User-Agent') ?? '[unknown]';
    const data = JSON.stringify({ target, address, client });
    channel.postMessage(JSON.stringify({ token, data }));
    sockets[token]?.send(data);
}

async function handle(request: Request, connection: ConnInfo): Promise<Response> {
    const path = request.url.substring(request.url.indexOf('/', 8));
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
        if (/^\/[a-z0-9]+$/i.test(path)) {
            const token = path.substring(1);
            const previousSocket = sockets[token];
            if (previousSocket !== undefined) {
                // https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent#Status_codes
                previousSocket.close(1001, 'Another client subscribed to this token.');
            }
            const { socket, response } = Deno.upgradeWebSocket(request);
            sockets[token] = socket;
            socket.onclose = () => sockets[token] = undefined;
            return response;
        } else {
            return new Response(undefined, {
                status: 404,
            });
        }
    } else if (/^\/[a-zA-Z0-9]+\.png$/.test(path)) {
        const token = path.slice(1, -4);
        notify(request, connection, token, 'Image');
        return new Response(blob, {
            headers: {
                'Content-Type': 'image/png',
                'Content-Length': pixel.length.toString(),
            },
        });
    } else if (/^\/[a-zA-Z0-9]+\/.*$/.test(path)) {
        const index = path.indexOf('/', 1);
        const token = path.substring(1, index);
        const link = path.substring(index + 1);
        notify(request, connection, token, 'Link');
        return new Response(undefined, {
            status: 307,
            headers: {
                'Location': decodeURIComponent(link),
            },
        });
    } else if (/^\/mta-sts\.txt\?domain=([a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?\.)+[a-z][-a-z0-9]{0,61}[a-z0-9]$/.test(path)) {
        const domain = path.split('=')[1];
        const url = 'https://mta-sts.' + domain + '/.well-known/mta-sts.txt';
        try {
            const response = await fetch(url, {
                headers: {
                    'Accept': 'text/plain',
                },
            });
            if (response.headers.has('content-type') && !response.headers.get('content-type')!.startsWith('text/plain')) {
                throw new Error('Received the wrong content type.');
            }
            return new Response(response.body, {
                status: response.status,
                headers: {
                    'Content-Type': 'text/plain',
                    'Content-Disposition': 'inline',
                    'Access-Control-Allow-Origin': '*',
                },
            });
        } catch (error) {
            console.warn(`An error occurred when fetching the MTA-STS file for ${domain}: ${error instanceof Error ? error.message : error}`);
            return new Response(undefined, {
                status: 404,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                },
            });
        }
    } else {
        return new Response(undefined, {
            status: 404,
        });
    }
}

serve(handle);
