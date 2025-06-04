import express from "express";
import mongoose from "mongoose";
// Remove this line: import adminRoutes from "./routes/admin.js";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(express.json());

// Remove this line: app.use("/api/admin", adminRoutes);

const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("Connected to MongoDB");
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection error:", err);
  });
