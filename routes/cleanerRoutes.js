// Dependencies
const express = require('express');
const router = express.Router();

// Middleware
const checkJwt = require('../middleware/checkJwt');
const checkUserInfo = require('../middleware/checkUserInfo');

// Helpers
const userModel = require('../models/userModel');
const propertyModel = require('../models/propertyModel');

router.get('/', checkJwt, checkUserInfo, async (req, res) => {
	try{
		const manager_id = req.user.user_id;
		/**
		 * Get a list of all cleaner IDs assigned to this manager
		 */
		const cleaner_ids = await propertyModel.getCleaners(manager_id);
		/**
		 * Add the manager to the list of potential cleaners,
		 * to handle default properties with no cleaners,
		 * as well as give the options to assign one's self
		 * to a property.
		 */
		cleaner_ids.push({cleaner_id: manager_id}); 


		/**
		 * Collect the full profile information for each cleaner in the cleaner IDs array
		 */

        const cleaner_profiles = [];
		console.log(cleaner_ids)
        for(let i = 0; i < cleaner_ids.length; i++){
            userModel.getUserById(cleaner_ids[i].cleaner_id).then(profile => {
				cleaner_profiles.push(profile);
            /**
             * Once we have collected all of the profiles, 
             * pass the array of cleaner profiles to the front-end.
             */
                if(cleaner_profiles.length === cleaner_ids.length){
                    return res.status(200).json({cleaner_profiles})
                }
            })
        }

		
	}catch(error){
		console.log(error);
		return res.status(500).json({error});
	}
});


router.get('/partners', checkJwt, checkUserInfo, async (req, res) => {
	try{
		const manager_id = req.user.user_id;
		const partners = await propertyModel.getPartners(manager_id);
		return res.status(200).json({partners});
	}
	catch(error){
		console.log(error);
		return res.status(500).json({error});
	}
});

/**
 * Update the default cleaner for a property
 */
router.put('/update/:property_id', checkJwt, checkUserInfo, async (req, res) => {
	console.log(req.body);
	try{
		const {property_id} = req.params;

		const {cleaner_id} = req.body;

		const updated = await propertyModel.changeCleaner(property_id, cleaner_id);

		console.log('change cleaner', updated);

		return res.status(200).json({updated});
	}catch(error){
		console.log(error);
		return res.status(500).json({error});
	}
})

module.exports = router;