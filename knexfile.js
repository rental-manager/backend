const pg = require('pg');

pg.defaults.ssl = process.env.PG_SSL
	? !!JSON.parse(String(process.env.PG_SSL))
	: true;

module.exports = {
	development: {
		client: 'pg',
		connection: {
			host: 'localhost',
			user: 'postgres',
			database: 'postgres'
		},
		useNullAsDefault: true,
		migrations: {
			directory: './data/migrations',
			tableName: 'migrations'
		},
		seeds: { directory: './data/seeds' }
	},

	production: {
		client: 'pg',
		connection: process.env.DATABASE_URL,
		pool: {
			min: 2,
			max: 10
		},
		useNullAsDefault: true,
		migrations: {
			directory: './data/migrations',
			tableName: 'migrations'
		},
		seeds: { directory: './data/seeds' }
	}
};
