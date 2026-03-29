const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['admin', 'superadmin', 'reporter'], default: 'admin' },
  // reporter accounts require approval by superadmin before they can login
  isApproved: { type: Boolean, default: false },
  // Unique reporter identifier (e.g. RJ-123456), generated at registration for reporters
  reporterId: { type: String, unique: true, sparse: true },
  // When the reporter was approved by admin/superadmin
  approvedAt: { type: Date },
  // Optional avatar path for reporter ID card
  avatar: { type: String },
  // Optional display role/title shown on the press card (e.g. "Reporter Tehsil Bilari")
  pressRole: { type: String },
  // Reporter region/locality (shown on press ID card)
  region: { type: String },
  // Additional reporter details for back-side of ID card
  dob: { type: String },
  bloodGroup: { type: String },
  address: { type: String },
  // Consent form fields
  isConsent: { type: Boolean, default: false },
  consentData: {
    name: { type: String },
    fatherName: { type: String },
    dateOfBirth: { type: String },
    gender: { type: String },
    maritalStatus: { type: String },
    bloodGroup: { type: String },
    mobileNumber: { type: String },
    alternateMobile: { type: String },
    email: { type: String },
    address: { type: String },
    reporterRole: { type: String },
    qualification: { type: String },
    profession: { type: String },
    appointmentDate: { type: String },
    pressCardDate: { type: String },
    photo: { type: String }, // base64 or image URL for reporter photo
    photoFile: { type: String }, // cloud URL for reporter photo
    signature: { type: String }, // base64 or image URL
    signatureFile: { type: String }, // cloud URL for signature
    consentSubmittedAt: { type: Date },
  },
  // Documents uploaded by superadmin for this reporter
  documents: [{
    name: { type: String, required: true },
    url: { type: String, required: true },
    key: { type: String, required: true }, // Storage key for deletion
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }],
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
