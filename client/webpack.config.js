/*
 *  webpack.config.js  --  chess frontend
 *	Webpack
 *	Builds one bundle & one .html page per page into client/dist, which the chess server serves
 *
 */

const HtmlWebpackPlugin = require('html-webpack-plugin');
const WebpackPwaManifest = require('webpack-pwa-manifest');
const path = require('path');
const { InjectManifest } = require('workbox-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { DefinePlugin } = require('webpack');
const Dotenv = require('dotenv-webpack');


module.exports = () => {
	return {
		mode: 'development',
		entry: { // ONE BUNDLE PER PAGE, THE SERVER PICKS THE PAGE (server/routes/pageRoutes.js)
			home: './src/js/pages/home/index.js',    // /              SIGNED IN
			guest: './src/js/pages/guest/index.js',  // /              GUEST
			play: './src/js/pages/play/index.js',    // /play          GUEST GAME, /play/:gameId SIGNED IN GAME
			settings: './src/js/pages/settings/index.js' // /settings  SIGNED IN
		},
		output: {
			filename: '[name].bundle.js',
			path: path.resolve(__dirname, 'dist'),
			publicPath: '/', // BUNDLES LOAD FROM THE ROOT, SO /play/:gameId DOESN'T ASK FOR /play/play.bundle.js
		},
		plugins: [
			new HtmlWebpackPlugin({ template: './home.html', filename: 'home.html', chunks: ['home'] }),
			new HtmlWebpackPlugin({ template: './guest.html', filename: 'guest.html', chunks: ['guest'] }),
			new HtmlWebpackPlugin({ template: './play.html', filename: 'play.html', chunks: ['play'] }),
			new HtmlWebpackPlugin({ template: './settings.html', filename: 'settings.html', chunks: ['settings'] }),

			new WebpackPwaManifest({ // manifest.json FOR "ADD TO HOME SCREEN" (THE ICONS ARE LINKED IN EACH .html)
				filename: 'manifest.json',
				inject: false,
				fingerprints: false,
				publicPath: '/',
				start_url: '/'
			}),

			new Dotenv({ // client/.env -> process.env.* IN THE BUNDLES & PAGES (CHESS_ASSESTS_URL, ...)
				path: `./.env`
			}),
		],
		module: {
			rules: [
				{
					test: /\.css$/i,
					use: ['style-loader', 'css-loader'],
				},
				{
					test: /\.m?js$/,
					exclude: /node_modules/,
					use: {
						loader: 'babel-loader',
						options: {
							presets: ['@babel/preset-env'],
						},
					},
				},
			],
		},
		resolve: {
			fallback: { crypto: false },
		},
		devServer: {
			devMiddleware: {
				writeToDisk: (filePath) => filePath.endsWith('.html'), // THE SERVER SENDS THE PAGES FROM client/dist, THE BUNDLES STAY IN MEMORY
			},
			proxy: [
				{ context: ['/api'], target: 'http://localhost:3001' }, // npm run dev: AUTH ROUTES LIVE ON THE EXPRESS SERVER (API_PORT)
				{ context: ['/socket.io'], target: 'http://localhost:3001', ws: true }, // FRIEND GAME SOCKET (server/socket.js)
				{ context: (pathname) => pathname == '/' || pathname == '/play' || pathname.startsWith('/play/') || pathname == '/settings', target: 'http://localhost:3001' }, // PAGES: THE SERVER PICKS WHICH ONE TO SEND
			],
		}
	};
};