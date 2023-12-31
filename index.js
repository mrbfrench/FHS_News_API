const http = require('http')
const fs = require('fs')
const path = require('path')
const config = require('./config.json')
const url = require('url')

const hostname = config.hostname
const port = config.port

// Check if the ./generated folder exists, and if not, make one
if (!fs.existsSync(path.resolve("./generated"))) {
	fs.mkdir(path.resolve("./generated"), function (e) {
		if (e) {
			throw e
		}
	})
}

const server = http.createServer((req, res) => {
	console.log(req.connection.remoteAddress + ' requested for ' + req.url + ' by method ' + req.method)

	if (req.method === 'GET') {
		const request = url.parse(req.url, true)
		const request_segments = request.pathname.split('/')
		const request_arguments = request.query

		if (request_segments[1] === '') { // If no path is specified
			res.writeHead(302, {
				'Location': 'https://splittikin.github.io/FHS-News-Docs/'
			})
			res.end()
		} else if (request_segments[1] === 'favicon.ico') {
			console.log('getting favicon')
			res.statusCode = 200
			fs.createReadStream(path.resolve('./pages/bruh.png')).pipe(res)
		} else if (request_segments[1] === 'api') {
			if (request_segments[2] === 'article') {
				getArticle(request_arguments, req, res)
			} else if (request_segments[2] === 'home') {
				loadHome(request_arguments, req, res)
			} else if (request_segments[2] === 'feedClubs') {
				loadClubs(request_arguments, req, res)
			} else if (request_segments[2] === 'club') {
				getClub(request_arguments, req, res)
			} else if (request_segments[2] === 'search_date') {
				search_date(request_arguments, req, res)
			} else if (request_segments[2] === 'weather') {
				getWeather(res)
			} else if (request_segments[2] === 'lunch') {
				getLunch(req, res)
			} else if (request_segments[2] === 'search') {
				search_string(request_arguments, req, res)
			} else {
				returnError(400, res)
			}
		} else if (request_segments[1] === 'files') {
			res.statusCode = 200
			fs.createReadStream(path.resolve('./pages' + req.url.split('/files')[1])).pipe(res) // req.url.split('/files')[1] effectively trim '/files' from the start of the string
		} else {
			returnError(404, res)
		}
	}
}) // http.createServer


server.listen(port, hostname, () => {
	console.log(`Server running at http://${hostname}:${port}/
http://${hostname}:${port}/api/home`)
})

function processItem(item) {
	if (item.itemType === "Club") {
		item.clubThumbnail = config.attachments_url + "clubs/" + 0 + "/" + item.clubThumbnail
	} else if (item.itemType === "Article") {
		item.articleThumbnail = config.attachments_url + "articles/" + item["articleId"] + "/" + item.articleThumbnail
		item.topperIcon = config.attachments_url + "articles/" + item["articleId"] + "/" + item.topperIcon
	}
	return item
}

async function returnError(errorCode, res) {
	res.statusCode = errorCode
	if (fs.existsSync('./pages/error/' + errorCode + '.html')) {
		fs.createReadStream('./pages/error/' + errorCode + '.html').pipe(res)
	} else {
		fs.createReadStream('./pages/error/generic.html').pipe(res)
	}
}

async function apiError(err, reqUrl = "Unknown", res) {
	const errorTime = Date.now()
	const writePath = './errors/' + errorTime + '.json'
	let errorLog = {
		"when": errorTime,
		"request": reqUrl,
		"err": err
	}
	fs.writeFileSync(writePath, JSON.stringify(errorLog, null, 4))

	res.writeHead(500, 'Content-Type', 'application/json')
	res.end(JSON.stringify(
		{
			"itemType": "ServerError",
			"details": "Something in the API went wrong! Check the errors/ folder."
		}
	))
}

async function clientError(err, res, code = 400) {
	res.setHeader('Content-Type', 'application/json')
	res.statusCode = code
	res.end(JSON.stringify(
		{
			"itemType": "ClientError",
			"details": err
		}
	))
}

async function loadHome(arguments, req, res) {
	let articlesNeeded = 5
	let articlesOffset = 0
	if (arguments["quantity"] != null) {
		if (arguments["quantity"] < 0) {
			await clientError("Argument quantity must be greater than 0", res)
			return
		} else {
			articlesNeeded = arguments["quantity"]
		}
	}
	if (arguments["position"] != null) {
		if (arguments["position"] < 0) {
			await clientError("Argument position must be greater than 0", res)
		} else {
			articlesOffset = arguments["position"]
		}
	}
	console.log("BRUH! i need " + articlesNeeded + " articles here!!!")

	let files = fs.readdirSync('./articles')
	/* Order should be something like this:
	Weather
	Alert (Red/Silver)
	Alert
	Lunch
	Articles
	Articles
	Articles
	Articles
	etc...

	Extras are grabbed in reverse order and added to the top of the list, so they appear in order.
	 */

	let returnData = []
	// Get lunch and add it to the top of the list
	let thisLunch = new Promise((resolve, _) => {
		fs.readFile('./extras/lunch.json', 'utf8', (err, data) => {
			if (err) {
				apiError(err, req.url, res)
				return
			} else {
				resolve(JSON.parse(data))
			}
		})
	})
	returnData.unshift(thisLunch)

	// Get alerts and add them to the top of the feed
	fs.readdirSync('./alerts/').sort().reverse().forEach(file => {
		let thisAlert = new Promise((resolve, reject) => {
			fs.readFile('./alerts/' + file, 'utf8', (err, data) => {
				if (err) {
					reject(err)
				} else {
					resolve(JSON.parse(data))
				}
			})
		})
		returnData.unshift(thisAlert)
	})

	// Get weather and add it to the top of the feed
	let thisWeather = new Promise((resolve, reject) => {
		fs.readFile('./extras/weather.json', 'utf8', (err, data) => {
			if (err) {
				reject(err)
			} else {
				resolve(JSON.parse(data))
			}
		})
	})
	returnData.unshift(thisWeather)

	// Last, get the articles and add them to the bottom
	let folders = files.filter(dirent => fs.lstatSync(path.resolve('./articles/' + dirent)).isDirectory())
	folders = folders.sort()
	let articlesFound = folders
	for (let val of articlesFound) {
		const jsonPath = path.resolve('./articles/' + val + '/article.json')
		console.log(jsonPath)
		let thisArticle = new Promise((resolve, _) => {
			resolve(processItem(JSON.parse(fs.readFileSync(jsonPath, 'utf8'))))
		})
		returnData.push(thisArticle)
	}
	returnData = returnData.slice(articlesOffset, articlesOffset + articlesNeeded)
	await Promise.all(returnData).then(returnArticles => {
		res.setHeader('Content-Type', 'application/json')
		res.setHeader('Access-Control-Allow-Origin', '*')
		res.statusCode = 200
		res.end(JSON.stringify(returnArticles))
	}).catch(err => {
		apiError("Rejected promise: " + err, req.url, res)
	})
}

async function getWeather(res) {
	console.log("getting weather!!!")
	fs.createReadStream('./extras/weather.json').pipe(res)
}

async function getLunch(req, res) {
	let data = fs.readFileSync('./extras/lunch.json', 'utf8')
	let lunchReturn = JSON.parse(data)

	// blah blah blah

	res.setHeader('Content-Type', 'application/json')
	res.statusCode = 200
	res.end(JSON.stringify(lunchReturn))
}

async function loadClubs(arguments, req, res) {
	let clubsNeeded = 5
	let clubsOffset = 0
	if (arguments["quantity"] != null) {
		clubsNeeded = parseInt(arguments["quantity"], 10)
		if (clubsNeeded < 0) {
			await clientError("Argument quantity must be positive!", res)
			return
		}
	}
	if (arguments["position"] != null) {
		clubsOffset = parseInt(arguments["position"], 10)
		if (clubsOffset < 0) {
			await clientError("Argument position must be positive!", res)
			return
		}
	}
	let folders = fs.readdirSync('./clubs').filter(dirent => fs.lstatSync(path.resolve('./clubs/' + dirent)).isDirectory())
	console.log("BRUH! i need " + clubsNeeded + " clubs here starting from position " + clubsOffset + "!!!")
	console.log(`Clubs position ${clubsOffset} through ${clubsNeeded + clubsOffset}`)
	folders.sort(function (a, b) {
		return a - b
	})
	let returnClubs = []
	for (let val of folders) {
		const jsonPath = path.resolve('./clubs/' + val + '/club.json')
		let thisClub = new Promise((resolve, reject) => {
			let thisClubReturn
			fs.readFile(jsonPath, 'utf8', (err, data) => {
				if (err) {
					reject(err)
				} else {
					thisClubReturn = JSON.parse(data)
					thisClubReturn = processItem(thisClubReturn)
					resolve(thisClubReturn)
				}
			})
		})
		returnClubs.push(thisClub)
	}
	returnClubs = returnClubs.slice(clubsOffset, clubsNeeded + clubsOffset)
	await Promise.all(returnClubs).then(returnClubs => {
		res.setHeader('Content-Type', 'application/json')
		res.statusCode = 200
		res.end(JSON.stringify(returnClubs))
	}).catch(err => {
		apiError("Rejected promise: " + err, req.url, res)
	})
}

async function search_date(queries, req, res) {
	let range_start = 0
	let range_end
	if (queries["range_start"] != null) {
		range_start = parseInt(queries["range_start"], 10)
	} else {
		await clientError("Argument range_start is required.", res)
		return
	}
	if (queries["range_end"] != null) {
		range_end = parseInt(queries["range_end"], 10)
	} else {
		range_end = range_start + 86400
	}
	if (range_end < range_start) {
		await clientError("Argument range_end must be after range_start.", res)
		return
	}
	console.log("BRUH! searching for articles between " + range_start + " and " + range_end)
	{
		if (!range_end) {
			range_end = range_start + 86400000 // 24 hours in milliseconds
		}
		let folders = fs.readdirSync('./articles').filter(dirent => fs.lstatSync(path.resolve('./articles/' + dirent)).isDirectory())
		let workingArticles = []
		let returnArticles = []
		for (let val of folders) {
			const jsonPath = path.resolve('./articles/' + val + '/article.json')
			console.log(jsonPath)
			let thisArticle = new Promise((resolve, reject) => {
				let thisArticleReturn
				fs.readFile(jsonPath, 'utf8', (err, data) => {
					if (err) {
						reject(err)
					} else {
						thisArticleReturn = JSON.parse(data)
						thisArticleReturn = processItem(thisArticleReturn)
						if (thisArticleReturn["postedTime"] >= range_start && thisArticleReturn["postedTime"] <= range_end) {
							returnArticles.push(thisArticleReturn)
						}
						resolve(thisArticleReturn)
					}
				})
			})
			workingArticles.push(thisArticle)
		}
		await Promise.all(workingArticles).then(_ => {
			let filteredJson = returnArticles.sort(function (a, b) {
				return a["postedTime"] - b["postedTime"]
			})
			res.setHeader('Content-Type', 'application/json')
			res.statusCode = 200
			res.end(JSON.stringify(filteredJson))
		}).catch(err => {
			apiError("Rejected promise: " + err, req, res)
		})
	}
}


async function search_string(arguments, req, res) {
	let position = 0
	if (arguments["position"] != null) {
		position = parseInt(arguments["position"], 10)
	}
	let quantity = 5
	if (arguments["quantity"] != null) {
		quantity = parseInt(arguments["quantity"], 10)
	}
	let query = ""
	if (arguments["query"] != null) {
		query = arguments["query"]
	} else {
		await clientError("Argument query is required.", res)
	}
	query = query.toLowerCase()
	let folders = fs.readdirSync('./articles').filter(dirent => fs.lstatSync(path.resolve('./articles/' + dirent)).isDirectory())
	console.log(folders)
	let filteredFolders = folders.filter(dirent => {
		let contents = JSON.parse(fs.readFileSync(path.resolve('./articles/'+dirent+'/article.json'), 'utf8'))
		let isHit = false
		for (field in contents) {
			try {
				if ((typeof contents[field] === 'string' || contents[field] instanceof String) && contents[field].toLowerCase().includes(query)) {
					isHit = true
				}
			} finally {

			}
		}
		return isHit
	}).slice(position, position + quantity)
	let returnArticles = []
	console.log(filteredFolders)
	for (index in filteredFolders) {
		let folder = filteredFolders[index]
		console.log(folder)
		returnArticles.push(new Promise((resolve, reject) => {
			try {
				resolve(JSON.parse(fs.readFileSync(path.resolve('./articles/' + folder + '/article.json'))))
			} catch {
				reject("Failure fetching article "+folder+" contents")
			}
		}))
	}
	console.log(returnArticles)
	await Promise.all(returnArticles).then(returnArticles => {
		console.log("promise.all")
		let filteredJson = returnArticles.sort(function (a, b) {
			return a["postedTime"] - b["postedTime"]
		})
		res.setHeader('Content-Type', 'application/json')
		res.statusCode = 200
		res.end(JSON.stringify(filteredJson))
	}).catch(err => {
		apiError("Rejected promise: " + err, req, res)
	})
	console.log("finish")
}

async function getArticle(arguments, req, res) {
	let requestedArticle
	if (arguments["id"] != null) {
		requestedArticle = arguments["id"]
	} else {
		requestedArticle = parseInt(req.url.split("/")[3], 10)
	}
	const articlePath = path.resolve('./articles/' + requestedArticle)
	console.log("BRUH! request for article " + requestedArticle + " which is at " + articlePath)
	const jsonPath = path.resolve(articlePath + "/article.json")
	if (fs.existsSync(jsonPath)) {
		fs.readFile(jsonPath, 'utf8', (err, data) => {
			if (err) {
				apiError(err, req, res)
			}
			const thisArticle = processItem(JSON.parse(data))
			res.setHeader('Content-Type', 'application/json')
			res.statusCode = 200
			res.end(JSON.stringify(thisArticle))
		})
	} else {
		await clientError("Article " + requestedArticle + " does not exist or is no longer available.", res, 404)
	}
}

async function getClub(arguments, req, res) {
	let requestedClub
	if (arguments["id"] != null) {
		requestedClub = arguments["id"]
	} else {
		requestedClub = parseInt(req.url.split("/")[3], 10)
	}
	const clubPath = path.resolve('./clubs/' + requestedClub)
	console.log("BRUH! request for club " + requestedClub + " which is at " + clubPath)
	if (fs.existsSync(path.resolve(clubPath + "/club.json"))) {

		const jsonPath = path.resolve(clubPath + "/club.json")
		fs.readFile(jsonPath, 'utf8', (err, data) => {
			if (err) {
				throw err
			}
			let thisClub = processItem(JSON.parse(data))
			res.setHeader('Content-Type', 'application/json')
			res.statusCode = 200
			res.end(JSON.stringify(thisClub))
		})
	} else {
		await clientError("Club " + requestedClub + " does not exist or is no longer available.", res, 404)
	}
}