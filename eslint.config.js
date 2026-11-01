// ESLint flat config for the whole repo (client, server and data service).
// Rules start as warnings because the code still mixes == and ===; promote them to "error" once they are cleaned up.

const js = require('@eslint/js');
const globals = require('globals');

const sharedRules = {
	eqeqeq: ['warn', 'always'],
	'no-unused-vars': ['warn', { args: 'after-used', ignoreRestSiblings: true, caughtErrors: 'none' }],
	'no-var': 'warn',
	'prefer-const': 'warn',
	'no-undef': 'error',
	'no-empty': ['warn', { allowEmptyCatch: true }]
};

module.exports = [
	{
		ignores: [
			'**/node_modules/**',
			'**/dist/**',
			'**/build/**',
			'client/public/**',
			'client/src/images/**',
			'**/.chrome-profile/**',
			'stockfish/**',
			'_dep/**',
			'sony/**',
			'terraform/**',
			'wiki/**',
			'workbench/**',
			'commands/**',
			'deploy/**',
			'docs/**'
		]
	},
	js.configs.recommended,

	// BROWSER CODE, BUNDLED BY WEBPACK (ES MODULES AND require(), process.env IS REPLACED AT BUILD TIME)
	{
		files: ['client/src/**/*.js'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'module',
			globals: { ...globals.browser, ...globals.commonjs, process: 'readonly' }
		},
		rules: sharedRules
	},

	// NODE CODE (COMMONJS): SERVER, DATA SERVICE AND BUILD CONFIGS
	{
		files: ['server/**/*.js', 'data-service/**/*.js', 'client/webpack.config.js', 'eslint.config.js'],
		languageOptions: {
			ecmaVersion: 'latest',
			sourceType: 'commonjs',
			globals: { ...globals.node }
		},
		rules: sharedRules
	}
];
