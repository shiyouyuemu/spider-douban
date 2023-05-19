
const fs = require("fs")
const path = require("path")
const { Cluster } = require('puppeteer-cluster');
const PromisePool = require("es6-promise-pool");
const { createEpub } = require("./createEpub")

const { MongoClient } = require('mongodb');
// or as an es module:
// import { MongoClient } from 'mongodb'

// Connection URL
const url = 'mongodb://localhost:27017';
const client = new MongoClient(url);

// Database Name
const dbName = 'douban';

async function main() {
	await client.connect();
	const db = client.db(dbName);
	const collection = db.collection('books');
	const cluster = await Cluster.launch({
		concurrency: Cluster.CONCURRENCY_BROWSER,
		maxConcurrency: 4,
		timeout: 3000000,
		puppeteerOptions: {
			headless: true,
			args: ['--disabled-gpu', '--no-sandbox', '--disable-dev-shm-usage']
		}
	});
	await cluster.task(task);
	let list = []
	const data = await collection.find({}).toArray()
	switch (process.env.type) {
		case "generateEpub":
			let promiseList = data.map(item => {
				return createEpub(item.id)
			})
			await Promise.all(promiseList)
			break;
		case "getList":
			await cluster.execute({ type: "list" })
			await collection.insertMany(list)
			break;
		case "getData":
			list = data.map(item => {
				return async () => {
					return await cluster.execute({ type: "item", bookId: item.id, collection })
				}
			}).filter(i => !!i)
			let time = {};
			let start = {};
			let end = {};
			const fn = function* () {
				for (let count = 0; count < list.length; count++) {
					start[`${count}`] = new Date().getTime();
					yield list[count]()
					end[`${count}`] = new Date().getTime();
					time[`${count}`] = (end[`${count}`] - start[`${count}`]) / 1000
					// console.clear();
					console.log(`progress:${count} / ${list.length}; speed: ${time[`${count}`]}s/张；预计剩余：${(list.length - count) * time[`${count}`] / 60}min `)
				}
			}
			const uploadPromiseIterator = fn();
			const uploadPool = new PromisePool(uploadPromiseIterator, 2)
			await uploadPool.start();
			break;
	}
	process.exit();
}

async function setBrowserSystem(page) {
	await page.setUserAgent(
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36"
	)
	await page.evaluateOnNewDocument(() => {
		const newProto = navigator.__proto__;
		delete newProto.webdriver; //删除 navigator.webdriver字段
		navigator.__proto__ = newProto;
		window.chrome = {};
		window.chrome.app = {
			InstallState: 'hehe',
			RunningState: 'haha',
			getDetails: 'xixi',
			getIsInstalled: 'ohno',
		};
		window.chrome.csi = function () { };
		window.chrome.loadTimes = function () { };
		window.chrome.runtime = function () { };
		Object.defineProperty(navigator, 'plugins', {
			//伪装真实的插件信息
			get: () => [
				{
					0: {
						type: 'application/x-google-chrome-pdf',
						suffixes: 'pdf',
						description: 'Portable Document Format',
						enabledPlugin: Plugin,
					},
					description: 'Portable Document Format',
					filename: 'internal-pdf-viewer',
					length: 1,
					name: 'Chrome PDF Plugin',
				},
				{
					0: {
						type: 'application/pdf',
						suffixes: 'pdf',
						description: '',
						enabledPlugin: Plugin,
					},
					description: '',
					filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
					length: 1,
					name: 'Chrome PDF Viewer',
				},
				{
					0: {
						type: 'application/x-nacl',
						suffixes: '',
						description: 'Native Client Executable',
						enabledPlugin: Plugin,
					},
					1: {
						type: 'application/x-pnacl',
						suffixes: '',
						description: 'Portable Native Client Executable',
						enabledPlugin: Plugin,
					},
					description: '',
					filename: 'internal-nacl-plugin',
					length: 2,
					name: 'Native Client',
				},
			],
		});
		const originalQuery = window.navigator.permissions.query; //notification伪装
		window.navigator.permissions.query = (parameters) =>
			parameters.name === 'notifications'
				? Promise.resolve({ state: Notification.permission })
				: originalQuery(parameters);
		const getParameter = WebGLRenderingContext.getParameter;
		WebGLRenderingContext.prototype.getParameter = function (parameter) {
			// UNMASKED_VENDOR_WEBGL
			if (parameter === 37445) {
				return 'Intel Inc.';
			}
			// UNMASKED_RENDERER_WEBGL
			if (parameter === 37446) {
				return 'Intel(R) Iris(TM) Graphics 6100';
			}
			return getParameter(parameter);
		};
	});
	await page.setViewport({ width: 335 * 3, height: 1334 })
}

async function task({ page, data }) {
	const client = await page.target().createCDPSession();

	await client.send('Network.enable', {
		maxResourceBufferSize: 1024 * 1024 * 100,
		maxTotalBufferSize: 1024 * 1024 * 200,
	});
	let result;
	await setBrowserSystem(page)
	switch (data.type) {
		case "list":
			result = await getList(page)
			break;
		case "item":
			result = await createBook(page, data.bookId, data.item, data.collection)
			break;
	}
	return result;
}

async function getList(page) {
	return new Promise(async (resolve) => {
		let list = []
		try {
			page.removeAllListeners("response");
			page.on('response', async res => {
				let url = res.url()
				if (url.indexOf("read.douban.com/j/kind") !== -1) {
					let resData = await res.json()
					list = [...list, ...resData.list]
					console.log(list.length)
					if (list.length < resData.total) {
						await page.waitForSelector('.page-next')
						await page.click(".page-next")
					} else {
						fs.writeFileSync(path.resolve(__dirname, "./list.json"), JSON.stringify(list))
						resolve(list)
					}
				}
			});
			await page.goto(`https://read.douban.com/tag/%E5%85%8D%E8%B4%B9%E5%85%AC%E7%89%88%E4%B9%A6/`)
		} catch (e) {
			console.log(e)
			resolve(null)
		}
	})
}

async function createBook(page, bookId, item, collection) {
	return new Promise(async (resolve) => {
		try {
			let loaded = false
			let newData
			page.removeAllListeners("response");
			page.on('response', async res => {
				let url = res.url()
				if (url.indexOf("article_v2/get_reader_data") !== -1) {
					try {
						let resData = await res.json()
						let data = await page.evaluate((data) => {
							function parse(t) {
								const e = Uint8Array.from(window.atob(t), (t => t.charCodeAt(0)))
									, i = e.buffer
									, d = e.length - 16 - 13
									, p = new Uint8Array(i, d, 16)
									, f = new Uint8Array(i, 0, d)
									, g = {};
								return g.name = "AES-CBC",
									g["iv"] = p,
									function () {
										const t = { isAnonymous: true }
											, e = t.isAnonymous ? get("bid") : t.id
											, i = (new TextEncoder).encode(e);
										return window["crypto"]["subtle"]["digest"]("SHA-256", i).then(t => {
											return window["crypto"]["subtle"]["importKey"]("raw", t, "AES-CBC", !0, ["decrypt"])
										})
									}().then(t => {
										return window["crypto"]["subtle"]["decrypt"](g, t, f)
									}).then(t => {
										return JSON.parse((new TextDecoder).decode(t))
									})
							}

							function get(e) {
								var t = document.cookie.match(new RegExp("(?:\\s|^)" + e + "\\=([^;]*)"));
								return t ? decodeURIComponent(t[1]) : null
							}
							return parse(data.data)
						}, resData)
						let book = ""
						data.posts.forEach(item => {
							item.contents.forEach(content => {
								book += `${content.data?.text || ""}\n`
							})
						})

						fs.writeFileSync(path.resolve(__dirname, `./${bookId}.json`), JSON.stringify({
							...resData,
							data,
							text: book
						}))
						newData = {
							...resData,
							data,
							text: book
						}
						await collection.updateOne({ id: bookId }, { $set: { ...newData } })
						if (loaded) {
							resolve(newData)
						}
					} catch (e) {
						console.log(e)
						console.log('getbook failed:', bookId)
						resolve(null)
					}
				}
			});
			await page.goto(`https://read.douban.com/reader/ebook/${bookId}/?dcs=ebook`)
			loaded = true;
			if (newData) {
				resolve(newData)
			}
		} catch (e) {
			console.log(e)
			resolve(null)
		}
	})
}

main()