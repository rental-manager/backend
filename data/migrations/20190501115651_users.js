exports.up = function(knex, Promise) {
	return knex.schema.createTable('users', table => {
		table.increments('user_id'); //primary key

		table
			.string('user_name', 32)
			.notNullable()
			.unique();

		table
			.string('email', 128)
			.notNullable()
			.unique();

		table.string('role', 16).notNullable();

		table.string('img_url', 256);

		table.string('phone', 32);

		table.string('address', 256);
	});
};

exports.down = function(knex, Promise) {
	return knex.schema.dropTableIfExists('users');
};
