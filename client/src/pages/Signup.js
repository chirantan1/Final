import React, { useState } from "react";
import axios from "axios";
import { useNavigate, Link } from "react-router-dom";
import "./Signup.css";

const Signup = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "patient",
    specialization: "",
    experience: "",
    phone: "",
    bio: "",
  });

  const navigate = useNavigate();

  const handleChange = (e) =>
    setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await axios.post(
        "https://final-year-project-9ydn.onrender.com/api/auth/signup",
        formData
      );
      alert("Signup successful! Please login.");
      navigate("/login");
    } catch (err) {
      if (err.response && err.response.data) {
        alert(err.response.data.message);
      } else {
        alert("Signup failed. Please try again.");
      }
    }
  };

  return (
    <div className="signup-container">
      <h2>Create an Account</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          name="name"
          placeholder="Full Name"
          required
          value={formData.name}
          onChange={handleChange}
        />
        <input
          type="email"
          name="email"
          placeholder="Email"
          required
          value={formData.email}
          onChange={handleChange}
        />
        <input
          type="password"
          name="password"
          placeholder="Password"
          required
          value={formData.password}
          onChange={handleChange}
        />
        <select name="role" onChange={handleChange} value={formData.role}>
          <option value="patient">Patient</option>
          <option value="doctor">Doctor</option>
        </select>

        {formData.role === "doctor" && (
          <>
            <input
              type="text"
              name="specialization"
              placeholder="Specialization"
              required
              value={formData.specialization}
              onChange={handleChange}
            />
            <input
              type="number"
              name="experience"
              placeholder="Years of Experience"
              required
              value={formData.experience}
              onChange={handleChange}
            />
            <input
              type="text"
              name="phone"
              placeholder="Phone Number"
              required
              value={formData.phone}
              onChange={handleChange}
            />
            <textarea
              name="bio"
              placeholder="Short Bio"
              required
              value={formData.bio}
              onChange={handleChange}
            />
          </>
        )}

        <button type="submit">Sign Up</button>
      </form>

      <p>
        Already have an account? <Link to="/login">Login here</Link>
      </p>
    </div>
  );
};

export default Signup;
