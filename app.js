const
	chalk = require('chalk'),
	logger = require('./utils/logger'),
	ms = require('ms'),
	needle = require('needle'),
	{ checkToken, checkForUpdates, redeemNitro, sendWebhook } = require('./utils/functions'),
	{ existsSync, readFileSync, watchFile, writeFileSync } = require('fs'),
	ProxyAgent = require('proxy-agent'),
	yaml = require('js-yaml');

const stats = { downloaded_codes: [], threads: 0, startTime: 0, used_codes: [], version: require('./package.json').version, working: 0 };

console.clear();
console.log(chalk.magenta(`
		 __     __  __	
		/  |   /  |/  |	
		$$ |   $$ |$$ |  ______    ______   __    __   ______	
		$$ |   $$ |$$ | /         /        /  |  /  | /       	
		$$    /$$/ $$ | $$$$$$  |/$$$$$$  |$$ |  $$ |/$$$$$$  |	
		 $$  /$$/  $$ | /    $$ |$$ |  $$ |$$ |  $$ |$$    $$ |	
		  $$ $$/   $$ |/$$$$$$$ |$$  __$$ |$$  __$$ |$$$$$$$$/	
		   $$$/    $$ |$$    $$ |$$    $$ |$$    $$/ $$      |	
		    $/     $$/  $$$$$$$/  $$$$$$$ | $$$$$$/   $$$$$$$/	
                                               $$ |	
                                               $$ |	
                                               $$/ 	 

       ${chalk.italic.gray(`v1.O - by Ryze`)}
`));

let config = yaml.load(readFileSync('./config.yml'));
watchFile('./config.yml', () => {
	config = yaml.load(readFileSync('./config.yml'));

	// Updates logger
	logger.level = config.debug_mode ? 'debug' : 'info';
	logger.info('Updated the config variables.              ');

	if (config.auto_redeem.enabled) checkToken(config.auto_redeem.token);
	return;
});

/* Load proxies, working proxies and removes duplicates */
const http_proxies = existsSync('./required/http-proxies.txt') ? (readFileSync('./required/http-proxies.txt', 'UTF-8')).split(/\r?\n/).filter(p => p !== '').map(p => 'http://' + p) : [];
const socks_proxies = existsSync('./required/socks-proxies.txt') ? (readFileSync('./required/socks-proxies.txt', 'UTF-8')).split(/\r?\n/).filter(p => p !== '').map(p => 'socks://' + p) : [];
const oldWorking = existsSync('./working_proxies.txt') ? (readFileSync('./working_proxies.txt', 'UTF-8')).split(/\r?\n/).filter(p => p !== '') : [];
let proxies = [...new Set(http_proxies.concat(socks_proxies.concat(oldWorking)))];

process.on('uncaughtException', () => { });
process.on('unhandledRejection', (e) => { console.error(e); stats.threads > 0 ? stats.threads-- : 0; });
process.on('SIGINT', () => { process.exit(); });
process.on('exit', () => { logger.info('Closing YANG... If you liked this project, make sure to leave it a star on github: https://github.com/Tenclea/YANG ! <3'); checkForUpdates(); });

(async () => {
	checkForUpdates();
	if (config.proxies.enable_scrapper) {
		logger.info('Downloading fresh proxies...');

		const downloaded = await require('./utils/proxy-scrapper')();
		proxies = [...new Set(proxies.concat(downloaded))];

		logger.info(`Downloaded ${chalk.yellow(downloaded.length)} proxies.`);
	}
	if (!proxies[0]) { logger.error('Could not find any valid proxies. Please make sure to add some in the \'required\' folder.'); process.exit(); }

	if (config.proxies.enable_checker) proxies = await require('./utils/proxy-checker')(proxies, config.threads);
	if (!proxies[0]) { logger.error('All of your proxies were filtered out by the proxy checker. Please add some fresh ones in the \'required\' folder.'); process.exit(); }

	logger.info(`Loaded ${chalk.yellow(proxies.length)} proxies.              `);

	const generateCode = () => {
		const code = Array.apply(0, Array(16)).map(() => {
			return ((charset) => {
				return charset.charAt(Math.floor(Math.random() * charset.length));
			})('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
		}).join('');
		return !stats.used_codes.includes(code) || stats.downloaded_codes.indexOf(code) == -1 ? code : generateCode();
	};

	const checkCode = async (code, proxy, retries = 0) => {
		logStats();
		if (!proxy) { stats.threads > 0 ? stats.threads-- : 0; return; }

		const agent = new ProxyAgent(proxy); agent.timeout = 5000;
		needle.get(
			`https://discord.com/api/v9/entitlements/gift-codes/${code}?with_application=false&with_subscription_plan=true`,
			{
				agent: agent,
				follow: 10,
				response_timeout: 10000,
				read_timeout: 10000,
				rejectUnauthorized: false,
			},
			(err, res, body) => {
				if (!body?.message && !body?.subscription_plan) {
					let timeout = 0;
					if (retries < 100) {
						retries++; timeout = 2500;
						logger.debug(`Connection to ${chalk.grey(proxy)} failed : ${chalk.red(res?.statusCode || 'INVALID RESPONSE')}.`);
					}
					else {
						// proxies.push(proxy); // don't remove proxy
						logger.debug(`Removed ${chalk.gray(proxy)} : ${chalk.red(res?.statusCode || 'INVALID RESPONSE')}`);
						proxy = proxies.shift();
					}

					logStats();
					return setTimeout(() => { checkCode(generateCode(), proxy, retries); }, timeout);
				}

				retries = 0; let p = proxy;
				stats.used_codes.push(code);
				if (!working_proxies.includes(proxy)) working_proxies.push(proxy);

				if (body.subscription_plan) {
					logger.info(`Found a valid gift code : https://discord.gift/${code} !`);

					// Try to redeem the code if possible
					redeemNitro(code, config);

					if (config.webhook.enabled && config.webhook.notifications.valid_code) {
						sendWebhook(config.webhook.url, `(${res.statusCode}) Found a \`${body.subscription_plan.name}\` gift code in \`${ms(+new Date() - stats.startTime, { long: true })}\` : https://discord.gift/${code}.`);
					}

					// Write working code to file
					let codes = existsSync('./validCodes.txt') ? readFileSync('./validCodes.txt', 'UTF-8') : '';
					codes += body?.subscription_plan || '???';
					codes += ` - https://discord.gift/${code}\n=====================================================\n`;
					writeFileSync('./validCodes.txt', codes);

					stats.working++;
				}
				else if (body.message === 'The resource is being rate limited.') {
					// timeouts equal to 600000 are frozen. Most likely a ban from Discord's side.
					const timeout = body.retry_after;
					if (timeout != 600000) {
						proxies.push(proxy);
						logger.warn(`${chalk.gray(proxy)} is being rate limited (${(timeout).toFixed(2)}s), ${proxies[0] === proxy ? 'waiting' : 'skipping proxy'}...`);
					}
					else {
						logger.warn(`${chalk.gray(proxy)} was most likely banned by Discord. Removing proxy...`);
					}
					p = proxies.shift();
				}
				else if (body.message === 'Unknown Gift Code') {
					logger.warn(`${code} was an invalid gift code.              `);
				}
				else { console.log(body?.message + ' - please report this on GitHub.'); }
				logStats();
				return setTimeout(() => { checkCode(generateCode(), p); }, p === proxy ? (body.retry_after * 1000 || 1000) : 0);
			});
	};

	const logStats = () => {
		// Update title and write stats to stdout
		const attempts = stats.used_codes.length;
		const aps = attempts / ((+new Date() - stats.startTime) / 1000) * 60 || 0;
		process.stdout.write(`Proxies: ${chalk.yellow(proxies.length + stats.threads)} | Attempts: ${chalk.yellow(attempts)} (~${chalk.gray(aps.toFixed(0))}/min) | Working Codes: ${chalk.green(stats.working)}  \r`);
		process.title = `YANG - by Tenclea | Proxies: ${proxies.length + stats.threads} | Attempts: ${attempts} (~${aps.toFixed(0)}/min) | Working Codes: ${stats.working}`;
		return;
	};

	const threads = config.threads > proxies.length ? proxies.length : config.threads;
	logger.info(`Checking for codes using ${chalk.yellow(threads)} threads.`);

	const working_proxies = [];
	stats.startTime = +new Date();
	if (config.webhook.enabled && config.webhook.notifications.boot) sendWebhook(config.webhook.url, 'Started **YANG**.');

	const startThreads = (t) => {
		for (let i = 0; i < t; i++) {
			checkCode(generateCode(), proxies.shift());
			stats.threads++;
			continue;
		}

		logger.debug(`Successfully started ${chalk.yellow(t)} threads.`);
	};

	startThreads(threads);

	setInterval(() => {
		// Close / restart program if all proxies used
		if (stats.threads === 0) {
			logger.info('Restarting using working_proxies.txt list.');
			proxies = (readFileSync('./working_proxies.txt', 'UTF-8')).split(/\r?\n/).filter(p => p !== '');
			if (!proxies[0]) {
				logger.error('Ran out of proxies.');
				if (config.webhook.enabled) return sendWebhook(config.webhook.url, 'Ran out of proxies.').then(setTimeout(() => { process.exit(); }, 2500));
				else return process.exit();
			}
			config.proxies.save_working = false;
			return startThreads(config.threads > proxies.length ? proxies.length : config.threads);
		}

		/* Save working proxies */
		if (config.proxies.save_working) { writeFileSync('./working_proxies.txt', working_proxies.sort(p => p.indexOf('socks')).join('\n')); }
	}, 10_000);

	let addingProxies = false;
	setInterval(async () => {
		checkForUpdates(true);
		if (addingProxies || !config.proxies.enable_scrapper) return;
		else addingProxies = true;

		logger.info('Downloading updated proxies.');

		const new_http_proxies = existsSync('./required/http-proxies.txt') ? (readFileSync('./required/http-proxies.txt', 'UTF-8')).split(/\r?\n/).filter(p => p !== '').map(p => 'http://' + p) : [];
		const new_socks_proxies = existsSync('./required/socks-proxies.txt') ? (readFileSync('./required/socks-proxies.txt', 'UTF-8')).split(/\r?\n/).filter(p => p !== '').map(p => 'socks://' + p) : [];

		const newProxies = new_http_proxies.concat(new_socks_proxies.concat(await require('./utils/proxy-scrapper')())).filter(p => !working_proxies.includes(p));
		const checked = await require('./utils/proxy-checker')(newProxies, config.threads, true);
		proxies = proxies.concat(checked);

		logger.info(`Added ${checked.length} proxies.`);
		startThreads(config.threads - stats.threads);
		addingProxies = false;
	}, 60 * 60 * 1000);
})();
