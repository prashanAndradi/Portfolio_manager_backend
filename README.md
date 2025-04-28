# Portfolio Manager Backend

This is the backend API for the Portfolio Manager application, built with Node.js, Express, and MySQL.

## Prerequisites

- Node.js (v14 or higher)
- MySQL Server
- npm or yarn

## Setup

1. Clone the repository
2. Navigate to the backend directory
3. Install dependencies:
   ```
   npm install
   ```
4. Configure the database:
   - Create a MySQL database
   - Update the .env file with your database credentials:
     ```
     DB_HOST=localhost
     DB_USER=your_username
     DB_PASSWORD=your_password
     DB_NAME=portfolio_manager
     PORT=3306
     ```

5. Initialize the database:
   ```
   npm run init-db
   ```

## Running the Server

Development mode with auto-restart:
```
npm run dev
```

Production mode:
```
npm start
```

## API Endpoints

### Accounts
- `GET /api/accounts` - Get all accounts
- `GET /api/accounts/:id` - Get account by ID
- `POST /api/accounts` - Create a new account
- `PUT /api/accounts/:id` - Update an account
- `DELETE /api/accounts/:id` - Delete an account

### Transaction Types
- `GET /api/transaction-types` - Get all transaction types
- `GET /api/transaction-types/:id` - Get transaction type by ID
- `POST /api/transaction-types` - Create a new transaction type
- `PUT /api/transaction-types/:id` - Update a transaction type
- `DELETE /api/transaction-types/:id` - Delete a transaction type

### Transactions
- `GET /api/transactions` - Get all transactions
- `GET /api/transactions/recent` - Get recent transactions
- `GET /api/transactions/account/:accountId` - Get transactions for a specific account
- `GET /api/transactions/:id` - Get transaction by ID
- `POST /api/transactions` - Create a new transaction
- `PUT /api/transactions/:id` - Update a transaction
- `DELETE /api/transactions/:id` - Delete a transaction

## Frontend Integration

Update your frontend API service to point to the backend URL. For example:

```javascript
// API URLs
const API_BASE_URL = 'http://localhost:3000/api';
const ACCOUNTS_URL = `${API_BASE_URL}/accounts`;
const TRANSACTION_TYPES_URL = `${API_BASE_URL}/transaction-types`;
const TRANSACTIONS_URL = `${API_BASE_URL}/transactions`;
``` 