const chalk = require('chalk'),
	logger = require('./logger'),
	ms = require('ms'),
	needle = require('needle');

module.exports = {
	checkToken: (token) => {
		const headers = { 'Content-Type': 'application/json', 'Authorization': token, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:84.0) Gecko/20100101 Firefox/84.0' };
		needle.get('https://discordapp.com/api/v9/users/@me', { response_timeout: 10000, headers: headers }, (err, res, body) => {
			if (err) { logger.error(`Could not login using the provided ${chalk.bold('redeemToken')} : ${err}`); }
			else if (body.message === '401: Unauthorized') { logger.error(chalk.red.bold(`Invalid redeemToken: ${chalk.reset.bold(`"${token}"`)}`)); }
			else { logger.debug(`Successfully logged in as ${chalk.bold(chalk.blue(body.username + '#' + body.discriminator))}.`); }
			return;
		});
	},

	updateAvailable: false,
	checkForUpdates: (silent = false) => {
		if (module.exports.updateAvailable) {
			if (silent) return;
			return logger.info(chalk.bold(`An update is available on GitHub (v${module.exports.updateAvailable}) ! ${chalk.blue('https://github.com/Tenclea/YANG')}`));
		}

		(async () => {
			const res = await needle('get', 'https://raw.githubusercontent.com/Tenclea/YANG/main/package.json')
				.catch(e => { logger.error(`Could not check for updates: ${e}`); return null; });

			if (!res?.body) return;
			const update = JSON.parse(res.body).version;
			const { version } = require('../package.json');

			if (version !== update) {
				module.exports.updateAvailable = update;
				if (!silent) return logger.info(chalk.bold(`An update is available on GitHub (v${module.exports.updateAvailable}) ! ${chalk.blue('https://github.com/Tenclea/YANG')}`));
			}
		})();
	},

	getCommunityCodes: async (stats) => {
		const res = await needle(
			'post',
			'https://yangdb.tenclea.repl.co/codes',
			{ codes: stats.used_codes.slice(-10000), version: stats.version },
			{ json: true, response_timeout: 30000 },
		).catch(() => { });

		return res?.body?.codes;
	},

	sendWebhook: (url, message) => {
		const date = +new Date();

		const data = JSON.stringify({ 'username': 'YANG', 'avatar_url': 'https://cdn.discordapp.com/attachments/794307799965368340/794356433806032936/20210101_010801.jpg', 'content': message });

		needle.post(url, data, { headers: { 'Content-Type': 'application/json' } }, (err, _, body) => {
			if (err || body.message) logger.error(`Could not deliver webhook message : ${err || body.message}`);
			else logger.debug(`Successfully delivered webhook message in ${ms(+new Date() - date, { long: true })}.`);
		});
	},

	redeemNitro: (code, config) => {
		if (!config.auto_redeem.enabled) return;

		needle.post(`https://discordapp.com/api/v9/entitlements/gift-codes/${code}/redeem`, '', { headers: { 'Authorization': config.auto_redeem.token } }, (err, res, body) => {
			if (err || !body) {
				console.log(err);
				logger.info(chalk.red(`Failed to redeem a nitro gift code : ${code} > ${err}.`));
			}

			else if (body.message === 'You are being rate limited.') {
				logger.warn(chalk.red(`You are being rate limited, trying to claim again in ${chalk.yellow(body.retry_after / 1000)} seconds.`));
				return setTimeout(() => { module.exports.redeemNitro(code, config); }, body.retry_after + 50);
			}
			else if (body.message === 'Unknown Gift Code') {
				return logger.warn(`${chalk.bold(code)} was an invalid gift code or had already been claimed.`);
			}
			else if (body.message === 'This gift has been redeemed already.') {
				if (config.webhook.enabled) { module.exports.sendWebhook(config.webhook.url, `This gift code (${code}) has already been redeemed...`); }
				return logger.warn(`${code} has already been redeemed...`);
			}
			else {
				if (config.webhook.enabled) { module.exports.sendWebhook(config.webhook.url, 'Successfully claimed a gift code !'); }
				return logger.info(chalk.green(`Successfully redeemed the nitro gift code : ${code} !`));
			}

		});
	},

	validateProxies: async (p) => {
		const res = await needle(
			'post',
			'https://yangdb.tenclea.repl.co/proxies',
			{ proxies: p }, { json: true, response_timeout: 5000 },
		).catch(() => { });

		return res?.body?.proxies || [];
	},
};
