import React, { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import "./PatientDashboard.css";

const PatientDashboard = () => {
  const [doctors, setDoctors] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [loadingDoctors, setLoadingDoctors] = useState(true);
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const navigate = useNavigate();

  // Fetch doctors
  useEffect(() => {
    const fetchDoctors = async () => {
      try {
        setLoadingDoctors(true);
        const res = await axios.get("http://localhost:5000/api/auth/doctors");
        setDoctors(res.data);
      } catch (err) {
        console.error("Error fetching doctors:", err);
      } finally {
        setLoadingDoctors(false);
      }
    };

    fetchDoctors();
  }, []);

  // Fetch appointments for patient
  useEffect(() => {
    const fetchAppointments = async () => {
      try {
        setLoadingAppointments(true);
        const token = localStorage.getItem("token");
        const res = await axios.get(
          "http://localhost:5000/api/appointments/patient",
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        console.log("Appointments response:", res.data);

        // ✅ FIX: Use 'data' instead of 'appointments'
        setAppointments(res.data.data || []);
      } catch (err) {
        console.error("Error fetching appointments:", err);
      } finally {
        setLoadingAppointments(false);
      }
    };

    fetchAppointments();
  }, []);

  const handleBook = (doctorId) => {
    navigate("/book", { state: { doctorId } });
  };

  return (
    <div className="dashboard-container">
      <h2 className="dashboard-title">Patient Dashboard</h2>

      <a
        href="https://disease-assistance-web.onrender.com"
        target="_blank"
        rel="noopener noreferrer"
      >
        <button className="ai-button">Ask our AI Assistant</button>
      </a>

      <section className="doctors-section" style={{ marginTop: "2rem" }}>
        <h3 className="section-title">Available Doctors</h3>
        {loadingDoctors ? (
          <p>Loading doctors...</p>
        ) : doctors.length === 0 ? (
          <p>No doctors found.</p>
        ) : (
          doctors.map((doc) => (
            <div
              className="card doctor-card"
              key={doc._id}
              style={{ marginBottom: "1rem" }}
            >
              <p>
                <strong>Name:</strong> Dr. {doc.name}
              </p>
              <p>
                <strong>Email:</strong> {doc.email}
              </p>
              <p>
                <strong>Specialization:</strong>{" "}
                {doc.specialization || "General"}
              </p>
              <button onClick={() => handleBook(doc._id)}>Book Appointment</button>
            </div>
          ))
        )}
      </section>

      <section className="appointments-section" style={{ marginTop: "3rem" }}>
        <h3 className="section-title">Your Appointments</h3>
        {loadingAppointments ? (
          <p>Loading appointments...</p>
        ) : !Array.isArray(appointments) || appointments.length === 0 ? (
          <p>No appointments booked yet.</p>
        ) : (
          appointments.map((appt) => (
            <div
              className="card appointment-card"
              key={appt._id}
              style={{ marginBottom: "1rem" }}
            >
              <p>
                <strong>Doctor:</strong> Dr. {appt.doctor?.name || "N/A"}
              </p>
              <p>
                <strong>Date:</strong>{" "}
                {appt.date ? new Date(appt.date).toLocaleString() : "N/A"}
              </p>
              <p>
                <strong>Status:</strong> {appt.status || "N/A"}
              </p>
            </div>
          ))
        )}
      </section>
    </div>
  );
};

export default PatientDashboard;
