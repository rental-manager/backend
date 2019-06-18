const db = require('../data/dbConfig');

const knexfile = require('../knexfile');
const knex = require('knex')(knexfile[process.env.NODE_ENV || 'development']);

const Promise = require('bluebird');

// Helpers
const checkForDuplicates = require('../helpers/checkForDuplicates');

module.exports = {
	getProperties,
	getDefaultProperties,
	getPropertyCleaners,
	getProperty,
	addProperty,
	updateProperty,
	checkOwner,

	getCleaners,
	changeCleaner,
	getPartners,

	checkCleaner,
	updateAvailability,
};

async function getProperties(user_id, role) {
	const managerPropertyFields =
		'p.property_id, p.property_name, p.cleaner_id, p.address, p.img_url, p.guest_guide, p.assistant_guide';

	const assistantPropertyFields =
		'p.property_id, p.property_name, p.manager_id, p.cleaner_id, p.address, p.img_url, p.guest_guide, p.assistant_guide';

	const properties =
		role === 'manager'
			? await db('properties as p')
					.where({ manager_id: user_id })
					.leftJoin('tasks as t', 'p.property_id', 't.property_id')
					.select(
						knex.raw(
							`${managerPropertyFields}, count(t.property_id) as task_count`
						)
					)
					.groupByRaw(managerPropertyFields)
					.orderBy('property_name') // Could be improved by using natural-sort
			: await db('properties as p')
					.join('partners as prt', 'p.manager_id', 'prt.manager_id')
					.where({ 'prt.cleaner_id': user_id })
					.join('users as u', 'p.manager_id', 'u.user_id')
					.leftJoin(
						'available_cleaners as ac',
						'p.property_id',
						'ac.property_id'
					)
					.where({ 'ac.cleaner_id': user_id })
					.orWhere({ 'ac.cleaner_id': null })
					.leftJoin('tasks as t', 'p.property_id', 't.property_id')
					.select(
						knex.raw(
							`${assistantPropertyFields}, u.user_name as manager_name, ac.cleaner_id as available, count(t.property_id) as task_count`
						)
					)
					.groupByRaw(`${assistantPropertyFields}, manager_name, available`)
					.orderBy('property_name'); // Could be improved by using natural-sort

	if (role !== 'manager') return properties;

	return await Promise.map(properties, async property => {
		const available_cleaners = await db('available_cleaners as ac')
			.where({
				property_id: property.property_id,
			})
			.join('users as u', 'ac.cleaner_id', 'u.user_id')
			.select('ac.cleaner_id', 'u.user_name as cleaner_name');

		return { ...property, available_cleaners };
	});
}

async function getDefaultProperties(user_id, role) {
	const defaultProperties =
		role === 'manager'
			? await db('properties as p')
					.where({ manager_id: user_id })
					.join('users as u', 'p.cleaner_id', 'u.user_id')
					.select(
						'p.property_id',
						'p.property_name',
						'p.cleaner_id',
						'u.user_name as cleaner_name'
					)
					.orderBy('property_name') // Could be improved by using natural-sort
			: await db('properties as p')
					.join('partners as prt', 'p.manager_id', 'prt.manager_id')
					.where({ 'prt.cleaner_id': user_id })
					.join('users as u', 'p.cleaner_id', 'u.user_id')
					.select(
						'p.property_id',
						'p.property_name',
						'p.cleaner_id',
						'u.user_name as cleaner_name'
					)
					.select('p.property_id', 'p.property_name', 'p.cleaner_id')
					.orderBy('property_name'); // Could be improved by using natural-sort

	return defaultProperties;
}

async function getPropertyCleaners(manager_id) {
	const cleaners = await db('partners as prt')
		.where({ manager_id })
		.join('users as u', 'prt.cleaner_id', 'u.user_id')
		.select('prt.cleaner_id', 'u.user_name as cleaner_name')
		.orderBy('cleaner_name');

	const unreducedPC = await db('properties as p')
		.where({ manager_id })
		.leftJoin('available_cleaners as ac', function() {
			this.on('p.property_id', '=', 'ac.property_id').on(
				'p.cleaner_id',
				'!=',
				'ac.cleaner_id'
			);
		})
		.leftJoin('users as u', 'ac.cleaner_id', 'u.user_id')
		.leftJoin('users as d', 'p.cleaner_id', 'd.user_id')
		.select(
			'p.property_id',
			'p.property_name',
			'p.address',
			'p.cleaner_id as default_cleaner_id',
			'd.user_name as default_cleaner_name',
			'ac.cleaner_id',
			'u.user_name as cleaner_name'
		)
		.orderBy(['p.property_id', 'cleaner_name']);

	return { cleaners, unreducedPC };
}

async function getProperty(user_id, property_id, role) {
	// This implementation doesn't support managers as assistants to other managers
	const property =
		role === 'manager'
			? await db('properties')
					.where({ manager_id: user_id, property_id })
					.first()
			: await db('properties')
					.join('partners', 'partners.manager_id', 'properties.manager_id')
					.where({ 'partners.cleaner_id': user_id, property_id })
					.select('properties.*')
					.first();

	if (!property) return {};

	const tasks = await db('tasks')
		.where({ property_id })
		.select('task_id', 'text', 'deadline');

	const available_cleaners = await db('available_cleaners as ac')
		.where({
			property_id: property.property_id,
		})
		.join('users as u', 'ac.cleaner_id', 'u.user_id')
		.select('ac.cleaner_id', 'u.user_name as cleaner_name');

	return { ...property, tasks, available_cleaners };
}

async function addProperty(propertyInfo) {
	const { manager_id, property_name, address } = propertyInfo;

	// Check for duplicate property names and addresses
	const notUniqueProperties = await db('properties')
		.where({ manager_id, property_name })
		.orWhere({ manager_id, address })
		.select('property_name', 'address');

	const notUnique =
		notUniqueProperties[0] &&
		(await checkForDuplicates(
			{ property_name, address },
			notUniqueProperties,
			'property_name'
		));

	if (notUnique) {
		return { notUnique };
	}

	// Add new property
	const [property_id] = await db('properties').insert(
		propertyInfo,
		'property_id'
	);

	return { property_id };
}

async function updateProperty(manager_id, property_id, propertyInfo) {
	// Will update this later. Needs to handle undefined property_name and/or address
	// const { property_name, address } = propertyInfo;

	// // Check for duplicate property names and addresses
	// const notUniqueProperties = await db('properties')
	// 	.whereNot({ property_id })
	// 	.andWhere({ manager_id, property_name })
	// 	.orWhereNot({ property_id })
	// 	.andWhere({ manager_id, address })
	// 	.select('property_id', 'property_name', 'address');

	// console.log('notUniqueProperties:', notUniqueProperties);

	// const notUnique =
	// 	notUniqueProperties[0] &&
	// 	(await checkForDuplicates(
	// 		{ property_name, address },
	// 		notUniqueProperties,
	// 		'property_name'
	// 	));

	// if (notUnique) return { notUnique };

	// Update property
	const updated = await db('properties')
		.where({ manager_id, property_id })
		.update(propertyInfo);

	return { updated };
}

function checkOwner(manager_id, property_id) {
	return db('properties')
		.where({ manager_id, property_id })
		.select('property_id')
		.first();
}

function getCleaners(manager_id) {
	return db('partners')
		.where({ manager_id })
		.select('cleaner_id');
}

async function getPartners(manager_id) {
	const partners = await db('users')
		.join('partners', 'users.user_id', 'partners.cleaner_id')
		.where({ manager_id })
		.select('*');
	return partners;
}

async function changeCleaner(property_id, cleaner_id) {
	const [updated] = await db('properties')
		.returning('*')
		.where({ property_id })
		.update({ cleaner_id });

	return { updated };
}

function checkCleaner(cleaner_id, property_id) {
	return db('properties')
		.join('partners', 'properties.manager_id', 'partners.manager_id')
		.where({ property_id, 'partners.cleaner_id': cleaner_id })
		.select('property_id')
		.first();
}

// Doesn't check for existing entries; can possibly return ugly errors
async function updateAvailability(cleaner_id, property_id, available) {
	return available
		? (await db('available_cleaners').insert(
				{ cleaner_id, property_id },
				'cleaner_id'
		  ))[0]
		: await db('available_cleaners')
				.where({ cleaner_id, property_id })
				.del();
}
