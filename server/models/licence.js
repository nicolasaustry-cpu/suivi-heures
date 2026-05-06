import mongoose from "mongoose";

const licenceSchema = new mongoose.Schema({
  codeClient: { type: String, required: true, unique: true },
  actif: { type: Boolean, default: true },
  dateActivation: { type: Date, default: Date.now },
  dateExpiration: { type: Date, required: true }
});

const Licence = mongoose.model("Licence", licenceSchema);
export default Licence;
