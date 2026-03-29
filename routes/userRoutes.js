const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const objectStorage = require('../services/objectStorage');
const multer = require('multer');
const path = require('path');
const mongoose = require('mongoose');

// List reporter accounts (superadmin only)
router.get('/reporters', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const reporters = await User.find({ role: 'reporter' }).select('-password').lean();
    // Normalize avatar: prefer DB blob -> data URL; else ensure local /uploads file exists, otherwise clear to avoid 404s
    const fs = require('fs');
    const path = require('path');
    const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;
    const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
    const mapped = reporters.map(u => {
      let avatar = '';
      if (u.avatarData && u.avatarMime) {
        try { avatar = `data:${u.avatarMime};base64,${Buffer.from(u.avatarData).toString('base64')}`; } catch (e) { avatar = ''; }
      }
      if (!avatar) {
        if (u.avatar && /^https?:\/\//i.test(u.avatar)) {
          // If objectStorage enabled and avatar looks like an R2 URL or contains uploads, prefer a signed URL
          if (objectStorage && objectStorage.enabled && (u.avatar.includes('/uploads/') )) {
            try {
              const fname = (u.avatar || '').split('/').pop();
              if (fname) avatar = objectStorage.getSignedUrl(`uploads/${fname}`);
              else avatar = u.avatar;
            } catch (e) {
              avatar = u.avatar;
            }
          } else avatar = u.avatar;
        } else if (u.avatar && u.avatar.startsWith('/uploads/')) {
          // check file exists locally
          const rel = u.avatar.startsWith('/') ? u.avatar.slice(1) : u.avatar;
          const abs = path.join(__dirname, '..', rel);
          try {
            if (fs.existsSync(abs)) avatar = origin + (u.avatar.startsWith('/') ? u.avatar : '/' + u.avatar);
            else {
              // if object storage enabled, try signed URL for the filename
              if (objectStorage && objectStorage.enabled) {
                const fname = (u.avatar || '').split('/').pop();
                if (fname) {
                  try { avatar = objectStorage.getSignedUrl(`uploads/${fname}`); } catch (e) { avatar = ''; }
                }
              } else avatar = '';
            }
          } catch (e) { avatar = ''; }
        } else avatar = '';
      }
      const out = Object.assign({}, u);
      out.avatar = avatar;
      out.pressRole = u.pressRole || '';
      out.dob = u.dob || '';
      out.bloodGroup = u.bloodGroup || '';
      out.address = u.address || '';
      delete out.avatarData;
      delete out.avatarMime;
      // include region in public response (if present)
      out.region = u.region || '';
      return out;
    });
    res.json({ success: true, data: mapped });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Return current user's public info (requires auth)
router.get('/me', auth.verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;
    let avatar = '';
    if (user.avatarData && user.avatarMime) {
      try {
        avatar = `data:${user.avatarMime};base64,${user.avatarData.toString('base64')}`;
      } catch (e) {
        avatar = '';
      }
    }
    if (!avatar) {
      avatar = user.avatar ? ( /^https?:\/\//i.test(user.avatar) ? user.avatar : origin + (user.avatar.startsWith('/') ? user.avatar : '/' + user.avatar) ) : '';
    }

    const out = user.toObject();
    out.avatar = avatar;
    // remove binary fields from API response to reduce payload
    delete out.avatarData;
    delete out.avatarMime;
    // include region for frontend
    out.region = user.region || '';
    // include display role for press card
    out.pressRole = user.pressRole || '';
    // include back-card fields
    out.dob = user.dob || '';
    out.bloodGroup = user.bloodGroup || '';
    out.address = user.address || '';
    // include consent form status
    out.isConsent = user.isConsent || false;
    out.consentData = user.consentData || null;

    res.json({ success: true, data: out });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Approve a reporter
router.put('/reporters/:id/approve', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Reporter not found' });
    if (user.role !== 'reporter') return res.status(400).json({ success: false, message: 'Not a reporter account' });

    user.isApproved = true;
    // set approvedAt to now (used for validity period)
    user.approvedAt = user.approvedAt || new Date();
    // ensure reporterId exists (should be set at registration but guard just in case)
    if (!user.reporterId) {
      user.reporterId = `RJ${Date.now().toString().slice(-6)}${Math.floor(Math.random()*900+100)}`;
    }

    await user.save();
    res.json({ success: true, message: 'Reporter approved', data: { id: user._id, isApproved: user.isApproved, reporterId: user.reporterId, approvedAt: user.approvedAt } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete reporter
router.delete('/reporters/:id', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'Reporter not found' });
    if (user.role !== 'reporter') return res.status(400).json({ success: false, message: 'Not a reporter account' });

    await User.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Reporter deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Submit consent form (reporter fills and submits)
router.post('/consent-form', auth.verifyToken, auth.requireRole(['reporter','admin']), async (req, res) => {
  try {
    const { name, fatherName, dateOfBirth, gender, maritalStatus, bloodGroup, mobileNumber, alternateMobile, email, address, reporterRole, qualification, profession, appointmentDate, pressCardDate, photo, signature } = req.body;
    
    if (!name || !fatherName || !mobileNumber || !email) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Initialize consent data
    const consentData = {
      name,
      fatherName,
      dateOfBirth,
      gender,
      maritalStatus,
      bloodGroup,
      mobileNumber,
      alternateMobile,
      email,
      address,
      reporterRole,
      qualification,
      profession,
      appointmentDate,
      pressCardDate,
      consentSubmittedAt: new Date(),
    };

    // Upload photo to R2 if provided
    if (photo && photo.startsWith('data:image')) {
      try {
        const base64Data = photo.split(',')[1];
        if (base64Data) {
          const buffer = Buffer.from(base64Data, 'base64');
          const photoKey = `consent-forms/photo-${user._id}-${Date.now()}.jpg`;
          const uploadResult = await objectStorage.uploadBuffer(buffer, photoKey, 'image/jpeg');
          consentData.photoFile = objectStorage.getPublicUrl(photoKey);
          consentData.photo = objectStorage.getPublicUrl(photoKey); // Store URL instead of base64
        }
      } catch (photoErr) {
        console.error('Photo upload error:', photoErr.message);
        // Continue without photo if upload fails
      }
    }

    // Upload signature to R2 if provided
    if (signature && signature.startsWith('data:image')) {
      try {
        const base64Data = signature.split(',')[1];
        if (base64Data) {
          const buffer = Buffer.from(base64Data, 'base64');
          const signatureKey = `consent-forms/signature-${user._id}-${Date.now()}.jpg`;
          const uploadResult = await objectStorage.uploadBuffer(buffer, signatureKey, 'image/jpeg');
          consentData.signatureFile = objectStorage.getPublicUrl(signatureKey);
          consentData.signature = objectStorage.getPublicUrl(signatureKey); // Store URL instead of base64
        }
      } catch (sigErr) {
        console.error('Signature upload error:', sigErr.message);
        // Continue without signature if upload fails
      }
    }

    // Update user consent data
    user.consentData = consentData;
    user.isConsent = true;

    await user.save();
    res.json({ success: true, message: 'Consent form submitted successfully', data: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get consent forms (superadmin only)
router.get('/consent-forms', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    
    const total = await User.countDocuments({ isConsent: true, role: 'reporter' });
    const forms = await User.find({ isConsent: true, role: 'reporter' })
      .select('name email reporterId consentData isApproved')
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ 'consentData.consentSubmittedAt': -1 });

    res.json({ 
      success: true, 
      data: forms, 
      pagination: { total, page, pages: Math.ceil(total / limit), limit } 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Multer setup for document uploads
let documentUpload;
if (objectStorage && objectStorage.enabled) {
  // Use memory storage for direct R2 upload
  documentUpload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  });
} else {
  // Use disk storage as fallback
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'documents');
      const fs = require('fs');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + '-' + file.originalname);
    }
  });
  documentUpload = multer({ 
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  });
}

// Upload document for a reporter (superadmin only)
router.post('/reporters/:id/documents', auth.verifyToken, auth.requireRole('superadmin'), documentUpload.single('document'), async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId);
    
    if (!user) return res.status(404).json({ success: false, message: 'Reporter not found' });
    if (user.role !== 'reporter') return res.status(400).json({ success: false, message: 'Not a reporter account' });
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    let documentUrl = '';
    let storageKey = '';

    if (objectStorage && objectStorage.enabled && req.file.buffer) {
      // Upload to R2
      const ext = path.extname(req.file.originalname);
      storageKey = `reporter-documents/${userId}/${Date.now()}${ext}`;
      await objectStorage.uploadBuffer(req.file.buffer, storageKey, req.file.mimetype);
      documentUrl = objectStorage.getPublicUrl(storageKey);
    } else if (req.file.path) {
      // Local storage
      storageKey = req.file.filename;
      documentUrl = `/uploads/documents/${req.file.filename}`;
    }

    // Add document to user's documents array
    if (!user.documents) user.documents = [];
    const uploadedBy = mongoose.Types.ObjectId.isValid(req.user.id) ? req.user.id : undefined;
    user.documents.push({
      name: req.file.originalname,
      url: documentUrl,
      key: storageKey,
      uploadedAt: new Date(),
      uploadedBy,
    });

    await user.save();
    
    res.json({ 
      success: true, 
      message: 'Document uploaded successfully',
      data: user.documents[user.documents.length - 1]
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Handle multer upload errors for documents
router.use('/reporters/:id/documents', (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, message: err.message });
  }
  return next(err);
});

// Get documents for a reporter (superadmin only)
router.get('/reporters/:id/documents', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const userId = req.params.id;
    const user = await User.findById(userId).select('name email reporterId role documents');
    
    if (!user) return res.status(404).json({ success: false, message: 'Reporter not found' });
    if (user.role !== 'reporter') return res.status(400).json({ success: false, message: 'Not a reporter account' });

    // Generate signed URLs for documents if using cloud storage
    const documents = (user.documents || []).map(doc => {
      let url = doc.url;
      if (objectStorage && objectStorage.enabled && doc.key) {
        try {
          url = objectStorage.getSignedUrl(doc.key, 3600); // 1 hour expiry
        } catch (e) {
          console.error('Error generating signed URL:', e);
        }
      }
      return {
        _id: doc._id,
        name: doc.name,
        url: url,
        uploadedAt: doc.uploadedAt,
      };
    });

    res.json({ 
      success: true, 
      data: {
        reporter: {
          id: user._id,
          name: user.name,
          email: user.email,
          reporterId: user.reporterId,
        },
        documents: documents
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Delete a document (superadmin only)
router.delete('/reporters/:id/documents/:docId', auth.verifyToken, auth.requireRole('superadmin'), async (req, res) => {
  try {
    const { id: userId, docId } = req.params;
    const user = await User.findById(userId);
    
    if (!user) return res.status(404).json({ success: false, message: 'Reporter not found' });
    if (user.role !== 'reporter') return res.status(400).json({ success: false, message: 'Not a reporter account' });

    // Find and remove the document
    const docIndex = user.documents.findIndex(d => d._id.toString() === docId);
    if (docIndex === -1) return res.status(404).json({ success: false, message: 'Document not found' });

    const document = user.documents[docIndex];
    
    // TODO: Delete from cloud storage if needed
    // if (objectStorage && objectStorage.enabled && document.key) {
    //   await objectStorage.deleteFile(document.key);
    // }

    user.documents.splice(docIndex, 1);
    await user.save();

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

// Public: reviewer card data (used to render press ID previews)
// Example: GET /api/users/reporters/:id/card
router.get('/reporters/:id/card', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ success: false, message: 'Bad request' });
    const user = await User.findById(id).select('-password');
    if (!user || user.role !== 'reporter') return res.status(404).json({ success: false, message: 'Reporter not found' });
    if (!user.isApproved) return res.status(403).json({ success: false, message: 'Reporter not approved yet' });

    const origin = (process.env.SERVER_URL && process.env.SERVER_URL.replace(/\/$/, '')) || `${req.protocol}://${req.get('host')}`;
    let avatar = '';
    if (user.avatarData && user.avatarMime) {
      try {
        avatar = `data:${user.avatarMime};base64,${user.avatarData.toString('base64')}`;
      } catch (e) {
        avatar = '';
      }
    }
    if (!avatar) {
      avatar = user.avatar ? ( /^https?:\/\//i.test(user.avatar) ? user.avatar : origin + (user.avatar.startsWith('/') ? user.avatar : '/' + user.avatar) ) : '';
    }

    // Calculate validity: 1 year from approvedAt (if approvedAt missing, use createdAt)
    const base = user.approvedAt || user.createdAt || new Date();
    const validUntil = new Date(base);
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    res.json({
      success: true,
      data: {
        id: user.reporterId || '',
        name: user.name,
        avatar,
        approvedAt: user.approvedAt,
        validUntil: validUntil.toISOString(),
        roleLabel: user.pressRole && user.pressRole.trim() ? user.pressRole : 'Reporter',
        region: user.region || '',
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
