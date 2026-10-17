// import { Treeview } from "../view/treeview";
// import { v4 as uuidv4 } from "uuid";
// import * as htmlHelper from "../htmlHelper";
// import $ from "jquery";
// import "jquery-ui";
// import "jquery-ui-css";

const auth0 = require('auth0-js');
// let hash;




export class InternalAuth {
	state;

	constructor(state) {
		this.hash = null;
		this.state = state;
		this.userInfo
	}

	initialize() { console.log("Internal Auth Init") }

	async authenticate() {
		let state = this.state
		if (window.location.ancestorOrigins.length == 0) {
			console.log(auth0.version)
			let webAuth = new auth0.WebAuth({
				domain: process.env.AUTH0_ISSUER_BASE_URL_ORIGIN,
				clientID: process.env.AUTH0_CLIENT_ID,
			});

			let authUrl
			if (!localStorage.getItem("hash")) {
				authUrl = webAuth.client.buildAuthorizeUrl({
					clientID: process.env.AUTH0_CLIENT_ID,
					responseType: 'token id_token',
					redirectUri: process.env.REDIRECT_URI,
					state: `test`,
					nonce: 'test'
				})
			} else { this.hash = localStorage.getItem("hash") }

			let auth0Response
			let userInfo;
			let accessToken;
			let clientToken;

			if (this.hash) {
				if (this.hash.split('=')[0] == "#access_token") {
					await webAuth.parseHash({ hash: this.hash, state: `test`, nonce: `test` }, async function (err, authResult) {
						if (err) {
							console.log("Invalid Token"); return handleAuthError()
						} else {
							await handleAuth(authResult?.accessToken);
						}

						function handleAuthError() {
							webAuth.authorize({
								clientID: process.env.AUTH0_CLIENT_ID,
								responseType: 'token id_token',
								redirectUri: process.env.REDIRECT_URI,
								state: `test`,
								nonce: 'test'
							});
						}

						async function handleAuth(accessToken) {
							let authReqCount = 0;
							const authInteval = setInterval(async function () {
								userInfo = await reqUser();
								authReqCount += 1;
								if (userInfo) {
									const returnObj = {
										userId: userInfo.user_id || '',
										screenname: userInfo.user_metadata?.screenname || '',
										siteSlug: "demo",
										signedIn: true,
										action: "user",
										gameReturnKey: "TEST_KEY",
										email: userInfo.email,
										emailVerified: userInfo.email_verified,
										firstName: userInfo.user_metadata?.first_name,
										lastName: userInfo.user_metadata?.last_name
									}
									window.clearInterval(authInteval);
									state.server.account = { ...state.server.account, ...returnObj }
									state.server.account.firstName = state.server.account.firstName
									state.server.account.json = { ...state.server.account.json, ...state.server.account }
									window.postMessage({ action: "auth-result", receiptToken: `${"auth-result"}-${"token"}`, userInfo }, window.location.origin);
								}
								else if (authReqCount == 5) {
									console.log("Request Limit Reached");
									window.clearInterval(authInteval);
									handleAuthError();
								}
							}, 3000);

							async function reqUser() { // THIS FUNCTION CANNOT BE CLIENT SIDE, MUST BE MOVED TO LAMBDA
								try {
									await webAuth.client.userInfo(accessToken, async function (err, user) {
										if (err) {
											console.log("Invalid Token");
											window.clearInterval(authInteval);
											return handleAuthError();
										} else {
											console.log("Local Hash");
											return auth0Response = user;
										}
									});
								} catch (err) {
									console.log("Invalid Token");
									window.clearInterval(authInteval);
									return handleAuthError();
								}


								if (auth0Response) {
									let options = {
										method: "POST",
										headers: { "Content-Type": "application/json" },
										body: JSON.stringify({ email: auth0Response?.email })
									};
									try {
										response = await fetch("https://backend.chess.aws-prac-route53.com/api/auth0", options).then(res => res.json());
										return response?.userData
									}
									catch (err) { return console.log(err) }
							} else { return; }
						}
					}
					});
			}
		} else if (this.hash === null) { window.location.href = authUrl; }
	}
}

saveState() { }

shutdown() { this.saveState(); }
}
