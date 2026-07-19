const express = require("express");

const router = express.Router();

const {
    submitReview,
    getApprovedReviews,
    getPendingReviews,
    approveReview,
    rejectReview,
    deleteReview,
    getReviewStats
} = require("../controllers/reviewController");

// Customer
router.post("/", submitReview);

// Website
router.get("/", getApprovedReviews);

// Admin
router.get("/pending", getPendingReviews);

router.patch("/:id/approve", approveReview);

router.patch("/:id/reject", rejectReview);

router.delete("/:id", deleteReview);

router.get("/stats", getReviewStats);

module.exports = router;