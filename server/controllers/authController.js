const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

// SIGNUP CONTROLLER
exports.signup = async (req, res) => {
  try {
    const { name, email, password, role, ...extra } = req.body;

    // Validate required fields
    if (!name || !email || !password || !role) {
      return res.status(400).json({
        success: false,
        message: "Name, email, password, and role are required",
      });
    }

    // Check if user already exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({
        success: false,
        message: "User already exists",
      });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 12); // Increased salt rounds for better security

    // Create the new user
    const newUser = await User.create({
      name,
      email,
      password: hashedPassword,
      role,
      ...extra,
    });

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role
      }
    });
  } catch (err) {
    console.error("Signup error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error during signup",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// LOGIN CONTROLLER - UPDATED WITH CONSISTENT PAYLOAD
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Find the user - include password for comparison
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ // Changed to 401 for unauthorized
        success: false,
        message: "Invalid credentials", // Generic message for security
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    // Create consistent payload
    const payload = {
      userId: user._id.toString(), // Ensure string conversion
      role: user.role,
      name: user.name,
      email: user.email
    };

    // Generate JWT with consistent options
    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { 
        expiresIn: process.env.JWT_EXPIRES_IN || '1d',
        algorithm: 'HS256' // Explicitly specify algorithm
      }
    );

    // Remove password from user data
    user.password = undefined;

    res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({
      success: false,
      message: "Server error during login",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// GET DOCTOR PROFILES
exports.getDoctors = async (req, res) => {
  try {
    const doctors = await User.find({ role: "doctor" })
      .select("-password -__v")
      .lean(); // Convert to plain JS object

    res.status(200).json({
      success: true,
      count: doctors.length,
      data: doctors,
    });
  } catch (err) {
    console.error("Get doctors error:", err.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch doctor profiles",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};