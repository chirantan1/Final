const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const protect = require("../middleware/auth");

const router = express.Router();

// @route POST /api/auth/signup
// @desc Register new user
// @access Public
router.post("/signup", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      specialization,
      experience,
      phone,
      bio,
    } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        message: "Name, email, password, and role are required",
      });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser)
      return res.status(400).json({ message: "Email already exists" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
      name,
      email,
      password: hashedPassword,
      role,
      specialization: role === "doctor" ? specialization : undefined,
      experience: role === "doctor" ? experience : undefined,
      phone: role === "doctor" ? phone : undefined,
      bio: role === "doctor" ? bio : undefined,
    });

    await newUser.save();

    res.status(201).json({ message: "User registered successfully" });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// @route POST /api/auth/login
// @desc Authenticate user & get token
// @access Public
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user)
      return res.status(404).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch)
      return res.status(401).json({ message: "Incorrect password" });

    const payload = {
      userId: user._id.toString(), 
      role: user.role,
      name: user.name,
      email: user.email
    };

    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.status(200).json({
      token,
      userId: user._id,
      name: user.name,
      role: user.role,
      email: user.email,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// @route GET /api/auth/doctors
// @desc Get all doctors
// @access Public
router.get("/doctors", async (req, res) => {
  try {
    const doctors = await User.find({ role: "doctor" }).select(
      "-password -__v"
    );
    res.status(200).json(doctors);
  } catch (err) {
    console.error("Error fetching doctors:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;