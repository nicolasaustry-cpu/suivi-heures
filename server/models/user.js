import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role:     { type: String, enum: ["client", "admin"], default: "client" },
  nom:      { type: String, default: "" },   // nom de l'entreprise cliente
  active:   { type: Boolean, default: true },
  createdAt:{ type: Date, default: Date.now }
});

export default mongoose.model("User", userSchema);
