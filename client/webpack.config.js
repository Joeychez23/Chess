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
		entry: {
			main: './src/js/main.js'
		},
		output: {
			filename: '[name].bundle.js',
			path: path.resolve(__dirname, 'dist'),
		},
		plugins: [
			new HtmlWebpackPlugin({
				template: './index.html',
			}),

			// Configure service worker on production builds
			
			// new InjectManifest({
			//   swSrc: './src-sw.js',
			//   swDest: 'src-sw.js',
			//   maximumFileSizeToCacheInBytes: 10485760,
			// }),

			new WebpackPwaManifest({
				filename: 'manifest.json',
				inject: false,
				fingerprints: false,
				publicPath: '/',
				start_url: '/'
			}),

			// new CopyWebpackPlugin({
			// 	patterns: [
			// 		{ from: 'src/images', to: 'images/' },
			// 		{ from: 'src/audio', to: 'audio/' },
			// 	]
			// }),

			new Dotenv({
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
		}
	};
};