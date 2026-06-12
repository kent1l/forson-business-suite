import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';

const { width } = Dimensions.get('window');

// Responsive button sizing based on screen width
const BUTTON_SIZE = Math.min((width - 80) / 3, 100);

export default function MobileCounter({ initialQuantity = 0, onSubmit }) {
  const [inputQuantity, setInputQuantity] = useState(initialQuantity.toString());

  const handleNumberPress = (num) => {
    setInputQuantity((prev) => {
      // Don't allow multiple leading zeros
      if (prev === '0') return num.toString();
      return prev + num.toString();
    });
  };

  const handleClear = () => {
    setInputQuantity('0');
  };

  const handleBackspace = () => {
    setInputQuantity((prev) => {
      if (prev.length <= 1) return '0';
      return prev.slice(0, -1);
    });
  };

  const handleIncrement = (amount) => {
    setInputQuantity((prev) => {
      const current = parseInt(prev || '0', 10);
      const next = current + amount;
      // Prevent negative numbers if needed, but here we just prevent less than 0
      return Math.max(0, next).toString();
    });
  };

  const handleSubmit = () => {
    if (onSubmit) {
      onSubmit(parseInt(inputQuantity || '0', 10));
    }
  };

  const renderButton = (label, onPress, isSecondary = false, isAction = false) => (
    <TouchableOpacity
      style={[
        styles.button,
        isSecondary && styles.secondaryButton,
        isAction && styles.actionButton,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.buttonText,
          isSecondary && styles.secondaryButtonText,
          isAction && styles.actionButtonText,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.displayContainer}>
        <Text style={styles.displayLabel}>Current Quantity</Text>
        <Text style={styles.displayText}>{inputQuantity}</Text>
      </View>

      <View style={styles.quickActionsContainer}>
        <TouchableOpacity style={styles.quickButton} onPress={() => handleIncrement(-1)}>
          <Text style={styles.quickButtonText}>-1</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickButton} onPress={() => handleIncrement(1)}>
          <Text style={styles.quickButtonText}>+1</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.numpadContainer}>
        <View style={styles.row}>
          {renderButton('1', () => handleNumberPress(1))}
          {renderButton('2', () => handleNumberPress(2))}
          {renderButton('3', () => handleNumberPress(3))}
        </View>
        <View style={styles.row}>
          {renderButton('4', () => handleNumberPress(4))}
          {renderButton('5', () => handleNumberPress(5))}
          {renderButton('6', () => handleNumberPress(6))}
        </View>
        <View style={styles.row}>
          {renderButton('7', () => handleNumberPress(7))}
          {renderButton('8', () => handleNumberPress(8))}
          {renderButton('9', () => handleNumberPress(9))}
        </View>
        <View style={styles.row}>
          {renderButton('C', handleClear, true)}
          {renderButton('0', () => handleNumberPress(0))}
          {renderButton('⌫', handleBackspace, true)}
        </View>
      </View>

      <TouchableOpacity
        style={styles.submitButton}
        onPress={handleSubmit}
        activeOpacity={0.7}
      >
        <Text style={styles.submitButtonText}>Submit</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    padding: 20,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  displayContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#f3f4f6',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  displayLabel: {
    fontSize: 18,
    color: '#6b7280',
    marginBottom: 8,
  },
  displayText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#111827',
  },
  quickActionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    maxWidth: 400,
    marginBottom: 20,
  },
  quickButton: {
    flex: 1,
    backgroundColor: '#e5e7eb',
    padding: 20,
    marginHorizontal: 8,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickButtonText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#374151',
  },
  numpadContainer: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 16,
  },
  button: {
    width: BUTTON_SIZE,
    height: BUTTON_SIZE,
    backgroundColor: '#f3f4f6',
    borderRadius: BUTTON_SIZE / 2,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  buttonText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  secondaryButton: {
    backgroundColor: '#fee2e2',
    borderColor: '#fca5a5',
  },
  secondaryButtonText: {
    color: '#ef4444',
  },
  actionButton: {
    backgroundColor: '#3b82f6',
    borderColor: '#2563eb',
  },
  actionButtonText: {
    color: '#ffffff',
  },
  submitButton: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#3b82f6',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
    minHeight: 56,
  },
  submitButtonText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#ffffff',
  },
});
