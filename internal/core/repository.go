package core

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	GetUserByUsername(ctx context.Context, username string) (*User, error)
	GetUserByID(ctx context.Context, id int64) (*User, error)
}

type pgRepository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) Repository {
	return &pgRepository{pool: pool}
}

func (r *pgRepository) GetUserByUsername(ctx context.Context, username string) (*User, error) {
	query := `
		SELECT u.id, u.username, u.password_hash, u.full_name, u.role, u.class_id, COALESCE(c.name, ''), u.is_active, u.created_at
		FROM core.users u
		LEFT JOIN core.classes c ON u.class_id = c.id
		WHERE u.username = $1
		LIMIT 1;
	`
	var u User
	var roleStr string
	var className string

	err := r.pool.QueryRow(ctx, query, username).Scan(
		&u.ID,
		&u.Username,
		&u.PasswordHash,
		&u.FullName,
		&roleStr,
		&u.ClassID,
		&className,
		&u.IsActive,
		&u.CreatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("pengguna tidak ditemukan")
		}
		return nil, fmt.Errorf("database query error: %w", err)
	}

	u.Role = Role(roleStr)
	u.ClassName = className
	return &u, nil
}

func (r *pgRepository) GetUserByID(ctx context.Context, id int64) (*User, error) {
	query := `
		SELECT u.id, u.username, u.password_hash, u.full_name, u.role, u.class_id, COALESCE(c.name, ''), u.is_active, u.created_at
		FROM core.users u
		LEFT JOIN core.classes c ON u.class_id = c.id
		WHERE u.id = $1
		LIMIT 1;
	`
	var u User
	var roleStr string
	var className string

	err := r.pool.QueryRow(ctx, query, id).Scan(
		&u.ID,
		&u.Username,
		&u.PasswordHash,
		&u.FullName,
		&roleStr,
		&u.ClassID,
		&className,
		&u.IsActive,
		&u.CreatedAt,
	)

	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("pengguna tidak ditemukan")
		}
		return nil, fmt.Errorf("database query error: %w", err)
	}

	u.Role = Role(roleStr)
	u.ClassName = className
	return &u, nil
}
