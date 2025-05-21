import React, { useState } from "react";
import axios from "axios";
import { useNavigate, Link } from "react-router-dom";
import "./Login.css";

const Login = () => {
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleChange = (e) =>
    setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post("http://localhost:5000/api/auth/login", formData);

      const { token, role } = res.data;
      if (token) {
        localStorage.setItem("token", token);
      }

      if (role === "doctor") {
        navigate("/doctor-dashboard");
      } else if (role === "patient") {
        navigate("/patient-dashboard");
      } else {
        setError("Unknown user role");
      }

      // Clear form
      setFormData({ email: "", password: "" });
    } catch (err) {
      if (err.response && err.response.data?.message) {
        setError("Login failed: " + err.response.data.message);
      } else {
        setError("Login failed: " + err.message);
      }
    }
  };

  return (
    <div className="login-container">
      <h2>Login</h2>

      <form onSubmit={handleSubmit} className="login-form">
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
        <button type="submit">Login</button>
      </form>

      {error && <p className="error-text">{error}</p>}

      <p>
        Don't have an account? <Link to="/signup">Sign up here</Link>
      </p>
    </div>
  );
};

export default Login;
