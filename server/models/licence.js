import mongoose from "mongoose";

const licenceSchema = new mongoose.Schema({
  codeClient:      { type: String, required: true, unique: true, uppercase: true, trim: true },
  nomClient:       { type: String, default: "" },
  email:           { type: String, default: "" },
  type:            { type: String, enum: ["standard", "plus"], default: "standard" },
  actif:           { type: Boolean, default: true },
  dateActivation:  { type: Date, default: Date.now },
  dateExpiration:  { type: Date, required: true },
  notes:           { type: String, default: "" }
});

export default mongoose.model("Licence", licenceSchema);
