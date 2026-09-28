from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class FaceRegistration(db.Model):
    __tablename__ = 'face_registration'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    image_path = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'image_path': self.image_path,
            'created_at': self.created_at.isoformat()
        }

class DetectionLog(db.Model):
    __tablename__ = 'detection_log'
    
    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    face_count = db.Column(db.Integer, default=0)
    detected_names = db.Column(db.Text, nullable=True)  # Comma-separated or JSON array
    image_path = db.Column(db.String(255), nullable=True) # Path to saved marked image

    def to_dict(self):
        return {
            'id': self.id,
            'timestamp': self.timestamp.isoformat(),
            'face_count': self.face_count,
            'detected_names': self.detected_names.split(',') if self.detected_names else [],
            'image_path': self.image_path
        }
