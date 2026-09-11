const tls = require('tls');
const net = require('net');

/**
 * 简易 SMTP 邮件发送（纯 Node.js 内置模块，无第三方依赖）
 * 支持 TLS (465) 和 STARTTLS (587)
 */
const sendMail = (config) => {
    const { host, port, user, pass, from, to, subject, html, text } = config;
    if (!host || !user || !pass || !to) {
        return Promise.reject(new Error('缺少必要邮件配置'));
    }

    const useTLS = port === 465;

    return new Promise((resolve, reject) => {
        const socket = useTLS
            ? tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => handshake(socket))
            : net.connect({ host, port }, () => handshake(socket));

        socket.setTimeout(15000);
        socket.on('timeout', () => {
            socket.destroy();
            reject(new Error('SMTP 连接超时'));
        });
        socket.on('error', reject);

        const auth = { user, pass };
        let step = 0;
        let buffer = '';

        const send = (cmd) => {
            socket.write(cmd + '\r\n');
        };

        const onData = (data) => {
            buffer += data.toString();
            const code = parseInt(buffer.substring(0, 3));
            const msg = buffer.split('\r\n').pop() || '';

            if (code >= 400) {
                socket.destroy();
                return reject(new Error(`SMTP 错误 ${code}: ${buffer.trim()}`));
            }

            // 握手流程
            if (step === 0) {
                // 收到 220 greeting
                if (!useTLS) {
                    send('EHLO apush');
                    step = 1;
                } else {
                    send('EHLO apush');
                    step = 2;
                }
            } else if (step === 1) {
                // STARTTLS
                send('STARTTLS');
                step = 2;
            } else if (step === 2) {
                // 升级为 TLS
                if (!useTLS && buffer.includes('220')) {
                    const tlsSocket = tls.connect({ socket, servername: host, rejectUnauthorized: false }, () => {
                        tlsSocket.removeAllListeners('data');
                        tlsSocket.on('data', onData);
                        send('EHLO apush');
                        step = 3;
                    });
                    tlsSocket.on('error', reject);
                    return;
                }
                send('AUTH LOGIN');
                step = 3;
            } else if (step === 3) {
                send(Buffer.from(auth.user).toString('base64'));
                step = 4;
            } else if (step === 4) {
                send(Buffer.from(auth.pass).toString('base64'));
                step = 5;
            } else if (step === 5) {
                const fromAddr = from || user;
                send(`MAIL FROM:<${fromAddr}>`);
                step = 6;
            } else if (step === 6) {
                send(`RCPT TO:<${to}>`);
                step = 7;
            } else if (step === 7) {
                send('DATA');
                step = 8;
            } else if (step === 8) {
                const fromAddr = from || user;
                const subjectB64 = subject ? `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=` : '';
                const body = [
                    `From: ${fromAddr}`,
                    `To: ${to}`,
                    `Subject: ${subjectB64}`,
                    `MIME-Version: 1.0`,
                    `Content-Type: text/html; charset=UTF-8`,
                    ``,
                    html || text || ''
                ].join('\r\n');
                send(body + '\r\n.');
                step = 9;
            } else if (step === 9) {
                send('QUIT');
                socket.end();
                resolve({ ok: true });
            }

            buffer = '';
        };

        socket.on('data', onData);
    });
};

module.exports = { sendMail };
