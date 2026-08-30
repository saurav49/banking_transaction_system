import app from './app';
import { config } from './config/env';

const PORT = config.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
