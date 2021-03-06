// Dependencies
const express = require('express');
const router = express.Router();

const moment = require('moment');

// Middleware
const checkJwt = require('../middleware/checkJwt');
const checkUserInfo = require('../middleware/checkUserInfo');

// Helpers
const guestModel = require('../models/guestModel');
const userModel = require('../models/userModel');
const propertyModel = require('../models/propertyModel');

// Mailgun 
const mailgunKey = process.env.MAILGUN_KEY;
const mailgunDomain = process.env.MAILGUN_URL;
const Mailgun = require('mailgun-js');

// Routes
/** Get guests by user_id */
router.get('/', checkJwt, checkUserInfo, async (req, res) => {
	const { user_id, role } = req.user;

	try {
		const guests = await guestModel.getGuests(user_id, role);

		res.status(200).json({ guests });
	} catch (error) {
		console.error(error);
		res.status(500).json({ error });
	}
});

/** Get a guest by guest_id */
router.get('/:guest_id', checkJwt, checkUserInfo, async (req, res) => {
	const { user_id, user_name, role } = req.user;
	const { guest_id } = req.params;

	try {
		const guest = await guestModel.getGuest(user_id, guest_id, role);

		if (!guest) {
			return res.status(404).json({ error: 'guest not found' });
		}

		// Add manager to available cleaners
		if (role === 'manager' && user_id !== guest.cleaner_id) {
			guest.availableCleaners.push({
				cleaner_id: user_id,
				cleaner_name: user_name,
			});
		}

		if (!guest.guest_id) {
			return res.status(404).json({ error: 'invalid guest id' });
		}

		res.status(200).json({ guest });
	} catch (error) {
		console.error(error);
		res.status(500).json({ error });
	}
});

/** Add a guest */
router.post('/:property_id', checkJwt, checkUserInfo, async (req, res) => {
	const { user_id, role } = req.user;
	const { property_id } = req.params;
	const { guest_name, checkin, checkout, email, cleaner_id } = req.body;

	const guestInfo = {
		property_id,
		guest_name,
		checkin: moment(checkin)
			.utc()
			.seconds(0)
			.milliseconds(0),
		checkout: moment(checkout)
			.utc()
			.seconds(0)
			.milliseconds(0),
		email,
		cleaner_id,
	};

	// Check role
	if (role !== 'manager') {
		return res.status(403).json({ error: 'not a manager' });
	}

	try {
		// Check property manager
		if (!(await propertyModel.checkOwner(user_id, property_id))) {
			return res.status(404).json({ error: 'invalid property' });
		}

		// Check cleaner (need to update this to take availability into account)
		const cleaner = await userModel.getPartner(user_id, cleaner_id);

		// make an exception is the manager is self-cleaning
		if (Number(cleaner_id) !== Number(user_id)) {
			if (cleaner_id && !(cleaner)) {
				return res.status(404).json({ error: 'invalid assistant' });
			}
		}

		// Add guest
		const { guest_id, notUnique } = await guestModel.addGuest(guestInfo);

		if (notUnique) {
			return res.status(409).json({ notUnique });
		}

		if (!guest_id) {
			return res.status(500).json({ error: 'something went wrong' });
		}

		if(cleaner && guest_id) { // If both inquiry of cleaner and guest addition were successful

		const property = await propertyModel.getProperty(user_id, property_id, role);

		const mailgun = new Mailgun({ apiKey: mailgunKey, domain: mailgunDomain });

		const data = {
			from: `Well-Broomed <Broom@well-broomed.com>`,
			to: `${cleaner.email}`,
			subject: 'New Guest Assignment',
			html: `Hello ${cleaner.user_name}, you have just been assigned as the cleaner for the stay of ${guestInfo.guest_name} at ${property.property_name}. They will be arriving at ${guestInfo.checkin}.`
		};

		mailgun.messages().send(data, function(err, body) {
			if (err) {
				console.log('Mailgun got an error: ', err);
				return { mailgunErr: err };
			} else console.log('body:', body);
		});
		}
		
		// TODO: notify cleaner of new guest

		res.status(200).json({ guest_id });
	} catch (error) {
		console.error(error);
		res.status(500).json({ error });
	}
});

/** Update a guest */
router.put('/:guest_id', checkJwt, checkUserInfo, async (req, res) => {
	const { user_id, role } = req.user;
	const { guest_id } = req.params;
	const {
		guest_name,
		property_id,
		checkin,
		checkout,
		email,
		cleaner_id,
	} = req.body;

	const guestInfo = {
		property_id,
		guest_name,
		checkin,
		checkout,
		email,
		cleaner_id,
	};

	// Check role
	if (role !== 'manager') {
		return res.status(403).json({ error: 'not a manager' });
	}

	try {
		// Check guest manager
		if (!(await guestModel.checkManager(user_id, guest_id))) {
			return res.status(404).json({ error: 'invalid guest' });
		}

		// Check property manager
		if (
			property_id &&
			!(await propertyModel.checkOwner(user_id, property_id))
		) {
			return res.status(404).json({ error: 'invalid property' });
		}

		//Gather all information on previous assigned cleaner before changes are made
		const previousGuestInfo = await guestModel.getGuest(user_id, guest_id, role)
		const previousCleaner = await userModel.getPartner(user_id, previousGuestInfo.cleaner_id);
		const cleaner = await userModel.getPartner(user_id, cleaner_id);

		// Check cleaner (need to update this to take availability into account)
		if (
			user_id !== cleaner_id &&
			!(cleaner)
		) {
			return res.status(404).json({ error: 'invalid assistant' });
		}

		// Update guest
		const { updated, notUnique } = await guestModel.updateGuest(
			guest_id,
			guestInfo
		);

		if (notUnique) {
			return res.status(409).json({ notUnique });
		}

		if (!updated) {
			return res.status(500).json({ error: 'something went wrong' });
		}

		const mailgun = new Mailgun({ apiKey: mailgunKey, domain: mailgunDomain });
		const property = await propertyModel.getProperty(user_id, property_id, role);

		const  newCleanerData = {
			from: `Well-Broomed <Broom@well-broomed.com>`,
			to: `${cleaner.email}`,
			subject: 'New Guest Assignment',
			html: `Hello ${cleaner.user_name}, you have just been assigned as the cleaner for the stay of ${guestInfo.guest_name} at ${property.property_name}. They will be arriving at ${guestInfo.checkin}.`
		};

		const prevCleanerData = {
			from: `Well-Broomed <Broom@well-broomed.com>`,
			to: `${previousCleaner.email}`,
			subject: 'Guest Unassigned',
			html: `Hello ${previousCleaner.user_name}, you have been removed as the cleaner for the stay of ${guestInfo.guest_name} at ${property.property_name}`
		}

		mailgun.messages().send(newCleanerData, function(err, body) {
			if (err) {
				console.log('Mailgun got an error: ', err);
				return { mailgunErr: err };
			} else console.log('body:', body);
		});

		mailgun.messages().send(prevCleanerData, function(err, body) {
			if (err) {
				console.log('Mailgun got an error: ', err);
				return { mailgunErr: err };
			} else console.log('body:', body);
		});

		res.status(200).json({ updated });
	} catch (error) {
		console.error(error);
		res.status(500).json({ error });
	}
});

/** Delete guest */
router.delete('/:guest_id', checkJwt, checkUserInfo, async (req, res) => {
	const { user_id, role } = req.user;
	const { guest_id } = req.params;

	// Check role
	if (role !== 'manager') {
		return res.status(403).json({ error: 'not a manager' });
	}

	try {
		// Check guest manager
		if (!(await guestModel.checkManager(user_id, guest_id))) {
			return res.status(404).json({ error: 'invalid guest' });
		}

		// Remove guest
		const deleted = await guestModel.removeGuest(guest_id);

		if (!deleted) {
			return res.status(500).json({ error: 'something went wrong' });
		}

		res.status(200).json({ deleted });
	} catch (error) {
		console.error(error);
		res.status(500).json({ error });
	}
});

/** Update guest_task */
router.put(
	'/:guest_id/tasks/:task_id',
	checkJwt,
	checkUserInfo,
	async (req, res) => {
		const { user_id } = req.user;
		const { guest_id, task_id } = req.params;
		const { completed } = req.body;

		try {
			// Check cleaner or manager
			if (
				!(await guestModel.checkCleaner(user_id, guest_id)) &&
				!(await guestModel.checkManager(user_id, guest_id))
			) {
				return res.status(404).json({ error: 'invalid guest' });
			}

			// Update guest task
			const [updatedTask] = await guestModel.updateGuestTask(
				guest_id,
				task_id,
				completed
			);

			if (!updatedTask) {
				return res.status(404).json({ error: 'invalid task id' });
			}

			res.status(200).json({ updatedTask });
		} catch (error) {
			console.error(error);
			res.status(500).json({ error });
		}
	}
);

/** Request a reassignment */
router.post(
	'/:guest_id/reassign/:cleaner_id',
	checkJwt,
	checkUserInfo,
	async (req, res) => {
		const { user_id, role } = req.user;
		const { guest_id, cleaner_id } = req.params;

		try {
			// Check cleaner
			if (!(await guestModel.checkCleaner(user_id, guest_id))) {
				return res.status(404).json({ error: 'invalid guest' });
			}

			// Create reassignment request or just assign manager
			const { newCleaner, notUnique } = await guestModel.reassignCleaner(
				guest_id,
				cleaner_id,
				role
			);

			if (notUnique) {
				return res.status(409).json({ notUnique });
			}

			if (!newCleaner) {
				return res.status(404).json({ error: 'invalid assistant' });
			}

			res.status(200).json({
				newCleaner,
			});
		} catch (error) {
			console.error(error);
			res.status(500).json({ error });
		}
	}
);

/** Cancel a reassignment */

/** Respond to a reassignment request */
router.put('/:guest_id/reassign', checkJwt, checkUserInfo, async (req, res) => {
	const { user_id } = req.user;
	const { guest_id } = req.params;
	const { accepted } = req.body;

	try {
		// Create reassignment request
		const { updated } = await guestModel.acceptReassignment(
			guest_id,
			user_id,
			accepted
		);

		if (!updated) {
			return res.status(404).json({ error: 'invalid request' });
		}

		res.status(200).json({ updated });
	} catch (error) {
		console.error(error);
		res.status(500).json({ error });
	}
});

module.exports = router;
