const validate = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    if (error.errors) {
      const formattedErrors = error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message
      }));
      return res.status(400).json({
        error: 'Dati di input non validi',
        details: formattedErrors
      });
    }
    res.status(400).json({ error: error.message });
  }
};

module.exports = { validate };
