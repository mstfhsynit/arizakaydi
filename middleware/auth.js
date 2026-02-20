const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "super-demo-secret-key";

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "Token gerekli." });
    return;
  }

  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: "Geçersiz veya süresi dolmuş token." });
  }
}

function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      res.status(403).json({ message: "Bu işlem için yetkiniz yok." });
      return;
    }
    next();
  };
}

module.exports = {
  JWT_SECRET,
  authenticateToken,
  authorizeRoles,
};
