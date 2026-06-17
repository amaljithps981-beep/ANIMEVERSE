import tensorflow as tf
from tensorflow.keras import layers, Model

def create_ncf_model(num_users, num_items, embedding_size=16):
    """
    Creates a Neural Collaborative Filtering (NCF) Model.
    Inputs:
        user_input: index of the user (integer)
        item_input: index of the content item (integer)
    Outputs:
        predicted_score: Float [0, 1] representing recommendation strength
    """
    # 1. User & Item Input Layers
    user_input = layers.Input(shape=(1,), name='user_input', dtype='int32')
    item_input = layers.Input(shape=(1,), name='item_input', dtype='int32')
    
    # 2. Embedding Layers (Dense representations representing relationships e.g. Naruto <-> One Piece)
    user_embedding = layers.Embedding(
        input_dim=num_users, 
        output_dim=embedding_size, 
        name='user_embedding',
        embeddings_initializer='he_normal'
    )(user_input)
    
    item_embedding = layers.Embedding(
        input_dim=num_items, 
        output_dim=embedding_size, 
        name='item_embedding',
        embeddings_initializer='he_normal'
    )(item_input)
    
    # Flatten vectors
    user_vec = layers.Flatten()(user_embedding)
    item_vec = layers.Flatten()(item_embedding)
    
    # 3. Concatenate user and item embeddings
    concat = layers.Concatenate()([user_vec, item_vec])
    
    # 4. Multi-Layer Perceptron (MLP) layers to learn complex interaction patterns
    fc1 = layers.Dense(64, activation='relu', kernel_initializer='he_normal')(concat)
    dropout1 = layers.Dropout(0.2)(fc1)
    
    fc2 = layers.Dense(32, activation='relu', kernel_initializer='he_normal')(dropout1)
    dropout2 = layers.Dropout(0.2)(fc2)
    
    fc3 = layers.Dense(16, activation='relu', kernel_initializer='he_normal')(dropout2)
    
    # 5. Output Prediction Score
    output = layers.Dense(1, activation='sigmoid', name='prediction')(fc3)
    
    # Compile the final Model
    model = Model(inputs=[user_input, item_input], outputs=output)
    return model
