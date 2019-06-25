// Dependencies
const express = require('express');
const router = express.Router();

// Middleware
const checkJwt = require('../middleware/checkJwt');
const checkUserInfo = require('../middleware/checkUserInfo');

// Helpers
const userModel = require('../models/userModel');
const propertyModel = require('../models/propertyModel');

// Mailgun 
const mailgunKey = process.env.MAILGUN_KEY;
const mailgunDomain = process.env.MAILGUN_URL;
const Mailgun = require('mailgun-js');

//Image Uploading
const multer = require("multer");
const storage = multer.memoryStorage();
const upload = multer({storage: storage});
const path = require('path');
const Datauri = require('datauri');
const dUri = new Datauri();
const cloudinary = require('cloudinary');
cloudinary.config({
	cloud_name:process.env.CLOUD_NAME,
	api_key: process.env.CLOUDINARY_API_KEY,
	api_secret: process.env.CLOUDINARY_API_SECRET
})

// Routes
/** Get properties by user_id */
router.get('/', checkJwt, checkUserInfo, async (req, res) => {
	const { user_id, role } = req.user;

	try {
		const properties = await propertyModel.getProperties(user_id, role);

		res.status(200).json({ properties });
	} catch (error) {
		console.error(error);
		res.status(500).json({ error });
	}
});

/** Get properties with less info for 'default properties' dropdowns */
router.get('/defaults', checkJwt, checkUserInfo, async (req, res) => {
	const { user_id, role } = req.user;

	try {
		const defaultProperties = await propertyModel.getDefaultProperties(
			user_id,
			role
		);

		res.status(200).json({ defaultProperties });
	} catch (error) {
		console.error(error);
		res.status(500).json({ error });
	}
});

/** Get Properties and cleaners (for adding/editing guests) */
router.get('/cleaners', checkJwt, checkUserInfo, async (req, res) => {
	const { user_id, user_name, role } = req.user;

	if (role !== 'manager') {
		return res.status(403).json({ error: 'not a manager' });
	}

	try {
		const { cleaners, unreducedPC } = await propertyModel.getPropertyCleaners(
			user_id
		);

		const properties = [];
		const availableCleaners = {};
		let p = null;

		unreducedPC.forEach(
			({
				property_id,
				property_name,
				address,
				default_cleaner_id,
				default_cleaner_name,
				cleaner_id,
				cleaner_name,
			}) => {
				if (property_id === p) {
					availableCleaners[property_id].push({ cleaner_id, cleaner_name });
				} else {
					p = property_id;

					properties.push({
						property_id,
						property_name,
						address,
						default_cleaner_id,
					});

					availableCleaners[property_id] = default_cleaner_id
						? [
								{
									cleaner_id: default_cleaner_id,
									cleaner_name: default_cleaner_name + ' (default cleaner)',
								},
						  ]
						: [];

					if (cleaner_id) {
						availableCleaners[property_id].push({ cleaner_id, cleaner_name });
					}
				}
			}
		);

		const otherCleaners = cleaners.map(({ cleaner_id, cleaner_name }) => ({
			cleaner_id,
			cleaner_name: cleaner_name + '*',
		}));
		otherCleaners.unshift({ cleaner_id: user_id, cleaner_name: user_name });

		res.status(200).json({
			propertyCleaners: { properties, otherCleaners, availableCleaners },
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ error });
	}
});

/** Get a property by property_id */
router.get('/:property_id', checkJwt, checkUserInfo, async (req, res) => {
	const { user_id, role } = req.user;
	const { property_id } = req.params;

	try {
		const property = await propertyModel.getProperty(
			user_id,
			property_id,
			role
		);

		if (!property) {
			return res.status(404).json({ error: 'property not found' });
		}

		res.status(200).json({ property });
	} catch (error) {
		console.error(error);
		res.status(500).json({ error });
	}
});

/** Add a new property */
router.post('/', checkJwt, checkUserInfo, upload.single('File'), async (req, res) => {
	const { user_id: manager_id, role } = req.user;
	const {
		property_name,
		address,
		guest_guide,
		assistant_guide,
		//cleaner_id
	} = req.body;

	const propertyInfo = {
		manager_id,
		property_name,
		address,
		guest_guide,
		assistant_guide,
	};

	
	console.log("body", req.body, "file", req.file, "img_url", propertyInfo.img_url || null);


	if (role !== 'manager') {
		return res.status(403).json({ error: 'not a manager' });
	}

	try {
		// if (cleaner_id && !(await userModel.getPartner(manager_id, cleaner_id))) { Redudant if a cleaner isn't assigned until after creating a property
		// 	return res.status(404).json({ error: 'invalid assistant' });
		// }

		if (req.file) {
			const file = dUri.format(
				path.extname(req.file.originalname).toString(),
				req.file.buffer
			).content;

			cloudinary.v2.uploader.upload(
				file,
				{
					use_filename: true,
					unique_filename: false
				},
				async (error, result) => {
					console.log(error, result);
					if (result) {
						propertyInfo.img_url = result.secure_url;
						console.log(propertyInfo);
						const {
							property_id,
							notUnique
						} = await propertyModel.addProperty(propertyInfo);

						if (notUnique) {
							return res.status(409).json({ notUnique });
						}

						res.status(201).json({ property_id });
					} else if (error) console.log(error);
				}
			);
		} else {
			const { property_id, notUnique } = await propertyModel.addProperty(
				propertyInfo
			);

			if (notUnique) {
				return res.status(409).json({ notUnique });
			}

			res.status(201).json({ property_id });
		}
		
	} catch (error) {
		console.error(error);
		res.status(500).json({ error });
	}
});

/** Update a property */
router.put('/:property_id', checkJwt, checkUserInfo, async (req, res) => {
	const { user_id, role } = req.user;
	const { property_id } = req.params;
	const {
		property_name,
		address,
		img_url,
		cleaner_id,
		guest_guide,
		assistant_guide,
	} = req.body;

	// Programmatically assign updated values based on what has been submitted
	const propertyInfo = {};

	for(var key in req.body){
		if(key !== undefined){
			propertyInfo[key] = req.body[key]
		}
	}

	if (role !== 'manager') {
		return res.status(403).json({ error: 'not a manager' });
	}

	try {
		if (cleaner_id && !(await userModel.getPartner(user_id, cleaner_id))) {
			return res.status(404).json({ error: 'invalid assistant' });
		}

		const { updated, notUnique } = await propertyModel.updateProperty(
			user_id,
			property_id,
			propertyInfo
		);

		if (notUnique) {
			return res.status(409).json({ notUnique });
		}

		if (!updated) {
			return res.status(404).json({ error: 'invalid property' });
		}

		res.status(200).json({ updated });
	} catch (error) {
		console.error(error);
		res.status(500).json({ error });
	}
});

/**
 * Delete a property
 */

router.delete('/:property_id', checkJwt, checkUserInfo, (req, res) => {
	const property_id = req.params.property_id;

	propertyModel.deleteProperty(property_id).then(status => {
		return res.status(200).json({message: `Property successfully deleted.`})
	}).catch(err => {
		console.log(err);
		return res.status(500).json({error: `Internal server error.`})
	})
})

/** Update availability */
router.put(
	'/:property_id/available/:cleaner_id*?',
	checkJwt,
	checkUserInfo,
	async (req, res) => {
		const { user_id, role } = req.user;
		const { property_id, cleaner_id } = req.params;
		const { available } = req.body;

		// If cleaner_id is provided, user_id is the property manager
		if (cleaner_id && +cleaner_id !== user_id && role !== 'manager') {
			return res.status(403).json({ error: 'not a manager' });
		}

		try {
			// Check property manager
			if (
				cleaner_id &&
				!(await propertyModel.checkOwner(user_id, property_id))
			) {
				return res.status(404).json({ error: 'invalid property' });
			}

			// Check partnership
			if (
				!(await propertyModel.checkCleaner(cleaner_id || user_id, property_id))
			) {
				return res.status(404).json({ error: 'invalid assistant' });
			}

			// Add or remove availability
			const updated = await propertyModel.updateAvailability(
				cleaner_id || user_id,
				property_id,
				available
			);

			if (!updated) {
				return res.status(500).json({ error: 'something went wrong' });
			}

			const mailgun = new Mailgun({
				apiKey: mailgunKey,
				domain: mailgunDomain
			});

			const cleaner = await userModel.getUserById(cleaner_id);
			const newProperty = await propertyModel.getProperty(
				user_id,
				property_id,
				role
			);

			console.log(newProperty, available);

			const data = {
				from: `Well-Broomed <Broom@well-broomed.com>`,
				to: `${cleaner.email}`,
				subject: 'Reassignment',
				html: available
					? `Hello ${cleaner.user_name}, you have been made available for ${
							newProperty.property_name
					  } located at ${
							newProperty.address
					  }. Please contact your manager for further details or questions.`
					: `Hello ${cleaner.user_name}, you have been made unavailable for ${
							newProperty.property_name
					  } located at ${
							newProperty.address
					  }. Please contact your manager for further details or questions.`
			};

			mailgun.messages().send(data, function(err, body) {
				if (err) {
					console.log('Mailgun got an error: ', err);
					return { mailgunErr: err };
				} else console.log('body:', body);
			});

			console.log(updated);

			res.status(200).json({ updated });
		} catch (error) {
			console.error(error);
			res.status(500).json({ error });
		}
	}
);

module.exports = router;
