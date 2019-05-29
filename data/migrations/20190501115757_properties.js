exports.up = function(knex, Promise) {
	return knex.schema.createTable('properties', table => {
		table.increments('property_id'); //primary key

		table
			.integer('manager_id')
			.unsigned()
			.notNullable()
			.references('users.user_id');

		table
			.integer('cleaner_id')
			.unsigned()
			.references('users.user_id');

		table
			.string('property_name', 128)
			.notNullable()
			.unique();

		table.string('address', 256).notNullable();

		table.string('img_url', 256);

		table.string('guest_guide', 256);

		table.string('assistant_guide', 256);

		table.unique(['manager_id', 'property_name']);

		table.unique(['manager_id', 'address']);

		table
            .timestamp('createdAt')
            .defaultTo(knex.fn.now());
        
        table
            .timestamp('updatedAt')
            .defaultTo(knex.fn.now());
	});
};

exports.down = function(knex, Promise) {
	return knex.schema.dropTableIfExists('properties');
};
