// ============================================================
// SEED DATA - Populates budget_meals with 50+ meal options for PostgreSQL
// ============================================================

async function seedBudgetMeals(pool) {
    // Clear table first to prevent duplicate seed values
    await pool.query('TRUNCATE TABLE budget_meals RESTART IDENTITY');

    const meals = [
        // --- BREAKFAST (under ₹200) ---
        { name: 'Oatmeal with Banana', cost: 100.00, calories: 350, category: 'breakfast', prep_time_minutes: 5, is_vegetarian: 1, is_vegan: 1, instructions: 'Cook oats with water, top with sliced banana and honey' },
        { name: 'Eggs on Toast', cost: 120.00, calories: 400, category: 'breakfast', prep_time_minutes: 8, is_vegetarian: 1, is_vegan: 0, instructions: 'Scramble 2 eggs, serve on toasted bread' },
        { name: 'Peanut Butter Toast', cost: 80.00, calories: 300, category: 'breakfast', prep_time_minutes: 3, is_vegetarian: 1, is_vegan: 1, instructions: 'Toast bread, spread peanut butter generously' },
        { name: 'Yogurt with Granola', cost: 150.00, calories: 320, category: 'breakfast', prep_time_minutes: 2, is_vegetarian: 1, is_vegan: 0, instructions: 'Mix yogurt with granola and berries' },
        { name: 'Banana Smoothie', cost: 120.00, calories: 280, category: 'breakfast', prep_time_minutes: 5, is_vegetarian: 1, is_vegan: 1, instructions: 'Blend banana, milk/oat milk, and honey' },
        { name: 'Rice Porridge', cost: 70.00, calories: 300, category: 'breakfast', prep_time_minutes: 15, is_vegetarian: 1, is_vegan: 1, instructions: 'Cook rice with extra water until soft, add sugar or salt' },
        { name: 'French Toast', cost: 120.00, calories: 380, category: 'breakfast', prep_time_minutes: 10, is_vegetarian: 1, is_vegan: 0, instructions: 'Dip bread in egg+milk mixture, pan fry' },
        { name: 'Overnight Oats', cost: 120.00, calories: 350, category: 'breakfast', prep_time_minutes: 5, is_vegetarian: 1, is_vegan: 1, instructions: 'Mix oats with milk and chia seeds, refrigerate overnight' },

        // --- LUNCH (under ₹300) ---
        { name: 'Rice and Beans', cost: 180.00, calories: 500, category: 'lunch', prep_time_minutes: 20, is_vegetarian: 1, is_vegan: 1, instructions: 'Cook rice, heat canned beans with spices, combine' },
        { name: 'Egg Fried Rice', cost: 220.00, calories: 450, category: 'lunch', prep_time_minutes: 15, is_vegetarian: 1, is_vegan: 0, instructions: 'Fry leftover rice with eggs, soy sauce, and veggies' },
        { name: 'Pasta with Tomato Sauce', cost: 180.00, calories: 480, category: 'lunch', prep_time_minutes: 15, is_vegetarian: 1, is_vegan: 1, instructions: 'Boil pasta, heat jarred sauce, combine' },
        { name: 'Grilled Cheese Sandwich', cost: 150.00, calories: 400, category: 'lunch', prep_time_minutes: 8, is_vegetarian: 1, is_vegan: 0, instructions: 'Butter bread, add cheese, grill until golden' },
        { name: 'Tuna Sandwich', cost: 250.00, calories: 420, category: 'lunch', prep_time_minutes: 8, is_vegetarian: 0, is_vegan: 0, instructions: 'Mix canned tuna with mayo, serve on bread with lettuce' },
        { name: 'Veggie Wrap', cost: 200.00, calories: 380, category: 'lunch', prep_time_minutes: 10, is_vegetarian: 1, is_vegan: 1, instructions: 'Fill tortilla with hummus, veggies, and avocado' },
        { name: 'Lentil Soup', cost: 150.00, calories: 350, category: 'lunch', prep_time_minutes: 25, is_vegetarian: 1, is_vegan: 1, instructions: 'Boil lentils with onion, carrot, and cumin' },
        { name: 'Ramen with Egg', cost: 120.00, calories: 450, category: 'lunch', prep_time_minutes: 10, is_vegetarian: 1, is_vegan: 0, instructions: 'Cook instant ramen, add boiled egg and green onion' },
        { name: 'Quesadilla', cost: 200.00, calories: 450, category: 'lunch', prep_time_minutes: 10, is_vegetarian: 1, is_vegan: 0, instructions: 'Fill tortilla with cheese and beans, grill both sides' },
        { name: 'PB&J Sandwich', cost: 100.00, calories: 380, category: 'lunch', prep_time_minutes: 3, is_vegetarian: 1, is_vegan: 1, instructions: 'Spread peanut butter and jelly on bread' },
        { name: 'Chickpea Salad', cost: 200.00, calories: 400, category: 'lunch', prep_time_minutes: 10, is_vegetarian: 1, is_vegan: 1, instructions: 'Mix canned chickpeas with cucumber, tomato, lemon, olive oil' },

        // --- DINNER (under ₹400) ---
        { name: 'Chicken Stir Fry with Rice', cost: 350.00, calories: 550, category: 'dinner', prep_time_minutes: 20, is_vegetarian: 0, is_vegan: 0, instructions: 'Stir fry chicken strips with veggies and soy sauce, serve over rice' },
        { name: 'Spaghetti Bolognese', cost: 320.00, calories: 580, category: 'dinner', prep_time_minutes: 25, is_vegetarian: 0, is_vegan: 0, instructions: 'Cook ground meat with tomato sauce and herbs, serve over pasta' },
        { name: 'Bean Tacos', cost: 250.00, calories: 480, category: 'dinner', prep_time_minutes: 15, is_vegetarian: 1, is_vegan: 1, instructions: 'Heat beans with spices, serve in tortillas with salsa and lettuce' },
        { name: 'Vegetable Curry with Rice', cost: 280.00, calories: 520, category: 'dinner', prep_time_minutes: 25, is_vegetarian: 1, is_vegan: 1, instructions: 'Cook veggies in coconut milk with curry paste, serve with rice' },
        { name: 'Baked Potato with Toppings', cost: 200.00, calories: 450, category: 'dinner', prep_time_minutes: 45, is_vegetarian: 1, is_vegan: 0, instructions: 'Bake potato, top with cheese, beans, or butter' },
        { name: 'Fried Rice with Vegetables', cost: 200.00, calories: 480, category: 'dinner', prep_time_minutes: 15, is_vegetarian: 1, is_vegan: 1, instructions: 'Fry leftover rice with mixed veggies and soy sauce' },
        { name: 'Pasta Primavera', cost: 280.00, calories: 450, category: 'dinner', prep_time_minutes: 20, is_vegetarian: 1, is_vegan: 1, instructions: 'Cook pasta, sauté mixed veggies with garlic and olive oil, combine' },
        { name: 'Black Bean Burrito', cost: 250.00, calories: 520, category: 'dinner', prep_time_minutes: 15, is_vegetarian: 1, is_vegan: 1, instructions: 'Fill large tortilla with rice, black beans, salsa, and avocado' },
        { name: 'Scrambled Eggs with Toast', cost: 180.00, calories: 400, category: 'dinner', prep_time_minutes: 10, is_vegetarian: 1, is_vegan: 0, instructions: 'Scramble eggs with veggies, serve with buttered toast' },
        { name: 'Tofu Stir Fry', cost: 280.00, calories: 420, category: 'dinner', prep_time_minutes: 20, is_vegetarian: 1, is_vegan: 1, instructions: 'Fry cubed tofu with broccoli, soy sauce, and ginger over rice' },
        { name: 'Mac and Cheese', cost: 180.00, calories: 500, category: 'dinner', prep_time_minutes: 15, is_vegetarian: 1, is_vegan: 0, instructions: 'Cook macaroni, mix with cheese sauce' },
        { name: 'Pancakes for Dinner', cost: 150.00, calories: 450, category: 'dinner', prep_time_minutes: 15, is_vegetarian: 1, is_vegan: 0, instructions: 'Make pancake batter, cook on griddle, top with syrup or fruit' },

        // --- SNACKS (under ₹150) ---
        { name: 'Trail Mix', cost: 150.00, calories: 200, category: 'snack', prep_time_minutes: 0, is_vegetarian: 1, is_vegan: 1, instructions: 'Mix nuts, raisins, and seeds' },
        { name: 'Apple with Peanut Butter', cost: 100.00, calories: 250, category: 'snack', prep_time_minutes: 2, is_vegetarian: 1, is_vegan: 1, instructions: 'Slice apple, dip in peanut butter' },
        { name: 'Hummus with Carrots', cost: 150.00, calories: 180, category: 'snack', prep_time_minutes: 2, is_vegetarian: 1, is_vegan: 1, instructions: 'Dip carrot sticks in hummus' },
        { name: 'Popcorn', cost: 50.00, calories: 150, category: 'snack', prep_time_minutes: 3, is_vegetarian: 1, is_vegan: 1, instructions: 'Pop kernels in pot with oil, add salt' },
        { name: 'Banana', cost: 20.00, calories: 105, category: 'snack', prep_time_minutes: 0, is_vegetarian: 1, is_vegan: 1, instructions: 'Peel and eat!' },
        { name: 'Rice Cakes with Avocado', cost: 150.00, calories: 200, category: 'snack', prep_time_minutes: 3, is_vegetarian: 1, is_vegan: 1, instructions: 'Spread mashed avocado on rice cakes, add salt and pepper' },
        { name: 'Boiled Eggs', cost: 80.00, calories: 150, category: 'snack', prep_time_minutes: 10, is_vegetarian: 1, is_vegan: 0, instructions: 'Boil eggs for 10 minutes, peel, add salt' },
        { name: 'Fruit Salad', cost: 150.00, calories: 150, category: 'snack', prep_time_minutes: 5, is_vegetarian: 1, is_vegan: 1, instructions: 'Chop seasonal fruits, mix together' },
    ];

    const insertText = `
        INSERT INTO budget_meals (name, cost, calories, category, prep_time_minutes, is_vegetarian, is_vegan, instructions)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;

    for (const meal of meals) {
        await pool.query(insertText, [
            meal.name,
            meal.cost,
            meal.calories,
            meal.category,
            meal.prep_time_minutes,
            meal.is_vegetarian,
            meal.is_vegan,
            meal.instructions
        ]);
    }

    console.log(`✓ Seeded ${meals.length} budget meals into PostgreSQL`);
}

module.exports = { seedBudgetMeals };
