import { hashPassword } from '../server/lib/passwords.js';

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk) => {
        data += chunk;
      });
      stdin.on('end', () => resolve(data.split(/\r?\n/)[0] || ''));
      stdin.resume();
      return;
    }

    stdout.write(question);
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
    };

    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n' || character === '\u0004') {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u0003') {
          cleanup();
          stdout.write('\n');
          reject(new Error('Cancelled'));
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        if (character >= ' ') value += character;
      }
    };

    stdin.on('data', onData);
  });
}

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

try {
  const argumentPassword = process.argv[2];
  let password = argumentPassword;

  if (!password) {
    password = await promptHidden('Admin password: ');
    const confirmation = await promptHidden('Confirm password: ');
    if (password !== confirmation) {
      fail('Passwords do not match.');
    }
  }

  const hash = await hashPassword(password);
  console.log(hash);

  if (argumentPassword) {
    console.error(
      'Note: passwords passed as command-line arguments can be saved in shell history. ' +
        'Prefer running the command without an argument.',
    );
  }
} catch (error) {
  fail(error.message);
}
