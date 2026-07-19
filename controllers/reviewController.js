const { Review } = require("../models");

// Submit review
exports.submitReview = async (req, res) => {
    try {

        const {
            name,
            email,
            city,
            favoriteFlavor,
            rating,
            review,
            title
        } = req.body;

        // Validation
        if (!name || !email || !rating || !review) {
            return res.status(400).json({
                success: false,
                message: "Please fill all required fields."
            });
        }

        const newReview = await Review.create({
            name,
            email,
            city,
            favoriteFlavor,
            rating,
            review,
            title,
            approved: false,
            verifiedPurchase: false
        });

        return res.status(201).json({
            success: true,
            message: "Thank you! Your review has been submitted for approval.",
            review: newReview
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Unable to submit review."
        });

    }
};

// Get approved reviews
exports.getApprovedReviews = async (req, res) => {
    try {

        const reviews = await Review.find({
            approved: true
        })
        .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: reviews.length,
            data: reviews
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Unable to fetch reviews."
        });

    }
};
// Get pending reviews (Admin)
exports.getPendingReviews = async (req, res) => {
    try {

        const reviews = await Review.find({
            approved: false
        }).sort({
            createdAt: -1
        });

        return res.status(200).json({
            success: true,
            count: reviews.length,
            data: reviews
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Unable to fetch pending reviews."
        });

    }
};
// Approve review
exports.approveReview = async (req, res) => {

    try {

        const review = await Review.findByIdAndUpdate(
            req.params.id,
            {
                approved: true
            },
            {
                new: true
            }
        );

        if (!review) {
            return res.status(404).json({
                success: false,
                message: "Review not found."
            });
        }

        return res.status(200).json({
            success: true,
            message: "Review approved.",
            data: review
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Unable to approve review."
        });

    }

};

// Reject review
exports.rejectReview = async (req, res) => {

    try {

        const review = await Review.findByIdAndDelete(req.params.id);

        if (!review) {

            return res.status(404).json({
                success: false,
                message: "Review not found."
            });

        }

        return res.status(200).json({
            success: true,
            message: "Review rejected and deleted."
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Unable to reject review."
        });

    }

};

// Delete review
exports.deleteReview = async (req, res) => {

    try {

        const review = await Review.findByIdAndDelete(req.params.id);

        if (!review) {

            return res.status(404).json({
                success: false,
                message: "Review not found."
            });

        }

        return res.status(200).json({
            success: true,
            message: "Review deleted."
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Unable to delete review."
        });

    }

};

// Review statistics
exports.getReviewStats = async (req, res) => {

    try {

        const totalReviews = await Review.countDocuments({
            approved: true
        });

        const avg = await Review.aggregate([
            {
                $match: {
                    approved: true
                }
            },
            {
                $group: {
                    _id: null,
                    average: {
                        $avg: "$rating"
                    }
                }
            }
        ]);

        return res.status(200).json({
            success: true,
            data: {
                totalReviews,
                averageRating: avg.length ? avg[0].average.toFixed(1) : 0
            }
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "Unable to fetch review statistics."
        });

    }

};